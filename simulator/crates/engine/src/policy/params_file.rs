//! The H0 policy params-file seam: load a **full** `HeuristicParams` vector from JSON so
//! Phase-H screens can run single-parameter arms without minting a `PolicyKind` per point.
//!
//! The file contract mirrors the app-formula weights file: every key present (missing and
//! unknown keys are load errors, checked structurally against the live struct's own
//! serialization so the contract cannot drift), gate blocks either `null` or fully
//! populated, `legacyValuation` pinned to `null` and `specialBuild` to `"uniform"` (both
//! are measurement-only surfaces owned by named roster labels, never swept). A vector
//! must then pass the shared domain guards (`validate_params`, the same conditions the
//! engine debug-asserts at every scoring entry) and the SIM-GAP-30 building-band headroom
//! check before it registers.
//!
//! A loaded vector becomes `PolicyKind::Custom(index)` through a registry mirroring the
//! app-formula one. The base kind a custom policy is registered against contributes only
//! its dispatch family (whether the seat participates in player trading); every parameter
//! comes from the file. `heuristic-v1-noports` is rejected as a base because its effect is
//! a port *rule*, not a parameter, and a params file cannot carry rules.

use std::cell::RefCell;
use std::sync::Mutex;

use serde_json::Value;

use crate::policy::PolicyKind;
use crate::policy::denial::DenialParams;
use crate::policy::devcards::DevCardParams;
use crate::policy::heuristic_v1::{
    HeuristicParams, LegacyValuation, SpecialBuildScoring, building_band_headroom, validate_params,
};
use crate::policy::threat::ThreatParams;
use crate::policy::trading::TradeParams;

/// Shared guard helper for the per-block `validate` functions.
pub(crate) fn check(rule: &str, ok: bool) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(format!("policy params violate: {rule}"))
    }
}

pub(crate) struct CustomPolicyDefinition {
    name: String,
    trades: bool,
    params: HeuristicParams,
}

static REGISTRY: Mutex<Vec<&'static CustomPolicyDefinition>> = Mutex::new(Vec::new());

std::thread_local! {
    /// Per-thread memo of registry lookups. Registration happens once during CLI setup,
    /// but `heuristic_params` resolves the definition on every dispatched decision;
    /// worker threads at full throughput would otherwise contend on the registry mutex
    /// millions of times per second.
    static DEFINITION_CACHE: RefCell<Vec<Option<&'static CustomPolicyDefinition>>> =
        const { RefCell::new(Vec::new()) };
}

/// Parses, validates, and registers a params-file policy, returning its `PolicyKind`.
/// Registering the same name with identical content returns the existing kind, so
/// repeated arm specs stay cheap; the same name with different content is an error
/// because the name is what runs record.
pub fn register_custom_policy(
    base: PolicyKind,
    name: String,
    source: &str,
) -> Result<PolicyKind, String> {
    let trades = crate::policy::custom_base_trades(base)?;
    let params = parse_params_file(source)?;
    let mut registry = REGISTRY
        .lock()
        .map_err(|_| "custom policy registry is poisoned".to_string())?;
    if let Some(index) = registry.iter().position(|existing| existing.name == name) {
        let existing = registry[index];
        if existing.trades == trades && existing.params == params {
            return Ok(PolicyKind::Custom(index as u8));
        }
        return Err(format!(
            "custom policy {name} is already registered with different params"
        ));
    }
    let index = u8::try_from(registry.len())
        .map_err(|_| "at most 256 custom params policies may be registered".to_string())?;
    registry.push(Box::leak(Box::new(CustomPolicyDefinition {
        name,
        trades,
        params,
    })));
    Ok(PolicyKind::Custom(index))
}

pub(crate) fn custom_params(index: u8) -> HeuristicParams {
    definition(index).params.clone()
}

pub(crate) fn custom_trades(index: u8) -> bool {
    definition(index).trades
}

fn definition(index: u8) -> &'static CustomPolicyDefinition {
    DEFINITION_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let slot = usize::from(index);
        if cache.len() <= slot {
            cache.resize(slot + 1, None);
        }
        if let Some(found) = cache[slot] {
            return found;
        }
        let found = REGISTRY
            .lock()
            .expect("custom policy registry is poisoned")
            .get(slot)
            .copied()
            .unwrap_or_else(|| panic!("custom policy index {index} is not registered"));
        cache[slot] = Some(found);
        found
    })
}

/// Parses one params file into a validated `HeuristicParams`. Public so tests and future
/// tools can exercise the contract without registering.
pub fn parse_params_file(source: &str) -> Result<HeuristicParams, String> {
    let value: Value =
        serde_json::from_str(source).map_err(|error| format!("invalid params JSON: {error}"))?;
    if !value.is_object() {
        return Err("params file must be a JSON object".into());
    }
    check_exact_keys(&value, &expected_shape(), "")?;
    let params: HeuristicParams =
        serde_json::from_value(value).map_err(|error| format!("invalid params value: {error}"))?;
    if params.legacy_valuation.is_some() {
        return Err(
            "params files pin legacyValuation to null: legacy restorations are \
             measurement-only and live behind named policy labels"
                .into(),
        );
    }
    if params.special_build != SpecialBuildScoring::Uniform {
        return Err(
            "params files pin specialBuild to \"uniform\": the M-30 measurement labels own \
             the other variants"
                .into(),
        );
    }
    validate_params(&params)?;
    building_band_headroom(&params)?;
    Ok(params)
}

/// The full key shape a params file must match: the live structs' own serialization with
/// every optional block populated, so a field added to any params struct widens the
/// contract automatically.
fn expected_shape() -> Value {
    serde_json::to_value(HeuristicParams {
        threat: Some(ThreatParams::default()),
        dev_cards: Some(DevCardParams::default()),
        trading: Some(TradeParams::default()),
        denial: Some(DenialParams::default()),
        legacy_valuation: Some(LegacyValuation::default()),
        ..HeuristicParams::default()
    })
    .expect("params serialize to JSON")
}

/// Structural exact-key check: at every object level the file's key set must equal the
/// shape's exactly; a `null` where the shape holds a block means the gate is off.
fn check_exact_keys(file: &Value, shape: &Value, path: &str) -> Result<(), String> {
    let (Some(file_object), Some(shape_object)) = (file.as_object(), shape.as_object()) else {
        return Ok(());
    };
    for key in shape_object.keys() {
        if !file_object.contains_key(key) {
            return Err(format!("params file is missing key {path}{key}"));
        }
    }
    for key in file_object.keys() {
        if !shape_object.contains_key(key) {
            return Err(format!("params file has unknown key {path}{key}"));
        }
    }
    for (key, shape_value) in shape_object {
        if shape_value.is_object() {
            let file_value = &file_object[key];
            if !file_value.is_null() {
                check_exact_keys(file_value, shape_value, &format!("{path}{key}."))?;
            }
        }
    }
    Ok(())
}

// Forwarded-argument table (the params-file seam):
//
// | argument                        | observed by                                            |
// |---------------------------------|--------------------------------------------------------|
// | file JSON -> `HeuristicParams`  | `the_loaded_params_reach_heuristic_params`             |
// | base kind -> dispatch family    | `the_base_kind_sets_trade_participation` and           |
// |                                 | `custom_base_family_matches_the_roster` (mod.rs)       |
// | name -> registry identity       | `re_registration_dedupes_and_conflicts_error`          |
// | key contract (missing/unknown)  | `every_missing_key_is_a_load_error`,                   |
// |                                 | `an_unknown_key_is_a_load_error`                       |
// | pinned fields                   | `legacy_valuation_and_special_build_are_pinned`        |
// | domain guards at load           | `a_domain_violation_is_a_load_error`                   |
// | SIM-GAP-30 headroom at load     | `the_headroom_boundary_is_exact`                       |
#[cfg(test)]
mod tests {
    use serde_json::Value;

    use crate::placement::app_formula::EngineWeights;
    use crate::policy::PolicyKind;
    use crate::policy::denial::DenialParams;
    use crate::policy::devcards::DevCardParams;
    use crate::policy::heuristic_v1::HeuristicParams;
    use crate::policy::threat::ThreatParams;
    use crate::policy::trading::TradeParams;
    use crate::rules::TradeConfig;

    use super::{parse_params_file, register_custom_policy};

    const DEFAULT_PARAMS_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../placement/policy-default-params.json"
    );
    const SWEEP_BOUNDS_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../placement/sweep-bounds.json"
    );
    const DEFAULT_WEIGHTS_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../placement/default-weights.json"
    );

    /// Serialization round trip through a string, so `f32` fields land as the same `f64`
    /// a JSON file's shortest-decimal spelling parses to.
    fn round_trip<T: serde::Serialize>(value: &T) -> Value {
        serde_json::from_str(&serde_json::to_string(value).expect("serialize")).expect("round trip")
    }

    fn composite_defaults() -> HeuristicParams {
        HeuristicParams {
            threat: Some(ThreatParams::default()),
            dev_cards: Some(DevCardParams::default()),
            trading: Some(TradeParams::default()),
            denial: Some(DenialParams::default()),
            ..HeuristicParams::default()
        }
    }

    /// A loadable full-composite params file as a JSON value.
    fn composite_value() -> Value {
        round_trip(&composite_defaults())
    }

    #[test]
    fn the_default_params_file_matches_the_struct_defaults() {
        let source = std::fs::read_to_string(DEFAULT_PARAMS_PATH).expect("committed file");
        let file: Value = serde_json::from_str(&source).expect("valid JSON");
        // Drift pin, both directions: the committed file is byte-for-byte the value shape
        // of `HeuristicParams::default()`, and loading it restores exactly the defaults.
        assert_eq!(file, round_trip(&HeuristicParams::default()));
        assert_eq!(parse_params_file(&source), Ok(HeuristicParams::default()));
    }

    #[test]
    fn a_full_composite_file_loads_exactly() {
        let source = serde_json::to_string(&composite_defaults()).expect("serialize");
        assert_eq!(parse_params_file(&source), Ok(composite_defaults()));
    }

    #[test]
    fn every_missing_key_is_a_load_error() {
        let full = composite_value();
        let top = full.as_object().expect("object");
        for key in top.keys() {
            let mut pruned = full.clone();
            pruned.as_object_mut().expect("object").remove(key);
            let error = parse_params_file(&pruned.to_string()).expect_err(key);
            assert!(error.contains("missing key"), "{key}: {error}");
        }
        for block in ["threat", "devCards", "trading", "denial"] {
            for key in top[block].as_object().expect("gate block").keys() {
                let mut pruned = full.clone();
                pruned[block].as_object_mut().expect("block").remove(key);
                let error = parse_params_file(&pruned.to_string()).expect_err(key);
                assert!(
                    error.contains(&format!("missing key {block}.{key}")),
                    "{block}.{key}: {error}"
                );
            }
        }
    }

    #[test]
    fn an_unknown_key_is_a_load_error() {
        let mut widened = composite_value();
        widened["bogus"] = Value::from(1.0);
        let error = parse_params_file(&widened.to_string()).expect_err("unknown top key");
        assert!(error.contains("unknown key bogus"), "{error}");

        let mut widened = composite_value();
        widened["threat"]["bogus"] = Value::from(1.0);
        let error = parse_params_file(&widened.to_string()).expect_err("unknown nested key");
        assert!(error.contains("unknown key threat.bogus"), "{error}");
    }

    #[test]
    fn legacy_valuation_and_special_build_are_pinned() {
        let mut with_legacy = composite_value();
        with_legacy["legacyValuation"] =
            round_trip(&crate::policy::heuristic_v1::LegacyValuation::default());
        let error = parse_params_file(&with_legacy.to_string()).expect_err("legacy");
        assert!(error.contains("legacyValuation"), "{error}");

        let mut with_special = composite_value();
        with_special["specialBuild"] = Value::from("mute");
        let error = parse_params_file(&with_special.to_string()).expect_err("special build");
        assert!(error.contains("specialBuild"), "{error}");
    }

    #[test]
    fn a_domain_violation_is_a_load_error() {
        let mut zero_floor = composite_value();
        zero_floor["trading"]["dangerFloor"] = Value::from(0.0);
        let error = parse_params_file(&zero_floor.to_string()).expect_err("danger floor");
        assert!(error.contains("trading.dangerFloor"), "{error}");

        let mut wide_mix = composite_value();
        wide_mix["frontierMix"] = Value::from(1.5);
        let error = parse_params_file(&wide_mix.to_string()).expect_err("frontier mix");
        assert!(error.contains("frontierMix"), "{error}");
    }

    /// Closed form: with every other vertex term zeroed the headroom bound is
    /// `BUILD_BAND + 15 * productionWeight` against the 11,500 contested floor, so the
    /// boundary sits exactly at `productionWeight = 100`.
    #[test]
    fn the_headroom_boundary_is_exact() {
        let lean = |production_weight: f32| HeuristicParams {
            production_weight,
            scarcity_weight: 0.0,
            diversity_bonus: 0.0,
            port_weight: 0.0,
            expansion_weight: 0.0,
            shed_weight: 0.0,
            ..HeuristicParams::default()
        };
        let below = serde_json::to_string(&lean(99.0)).expect("serialize");
        assert_eq!(parse_params_file(&below), Ok(lean(99.0)));
        let at = serde_json::to_string(&lean(100.0)).expect("serialize");
        let error = parse_params_file(&at).expect_err("headroom");
        assert!(error.contains("headroom"), "{error}");
    }

    #[test]
    fn the_loaded_params_reach_heuristic_params() {
        // Non-default values throughout one gate plus the core, so equality of the whole
        // struct proves the file's numbers (not a kind's own params) reach dispatch.
        let expected = HeuristicParams {
            production_weight: 2.5,
            goal_need_weight: 0.75,
            threat: Some(ThreatParams {
                delay_weight: 1.75,
                ..ThreatParams::default()
            }),
            trading: Some(TradeParams::default()),
            ..composite_defaults()
        };
        let source = serde_json::to_string(&expected).expect("serialize");
        let kind = register_custom_policy(
            PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial,
            "composite@reach-test".into(),
            &source,
        )
        .expect("registers");
        let PolicyKind::Custom(index) = kind else {
            panic!("registration returns a custom kind");
        };
        assert_eq!(crate::policy::heuristic_params(kind), expected);
        assert!(super::custom_trades(index));
    }

    #[test]
    fn the_base_kind_sets_trade_participation() {
        let source = serde_json::to_string(&HeuristicParams::default()).expect("serialize");
        let plain = register_custom_policy(
            PolicyKind::HeuristicV1,
            "heuristic-v1@family-test".into(),
            &source,
        )
        .expect("plain base registers");
        let PolicyKind::Custom(plain_index) = plain else {
            panic!("custom kind");
        };
        assert!(!super::custom_trades(plain_index));

        let trader = register_custom_policy(
            PolicyKind::HeuristicV1Trader,
            "heuristic-v1-trader@family-test".into(),
            &source,
        )
        .expect("trader base registers");
        let PolicyKind::Custom(trader_index) = trader else {
            panic!("custom kind");
        };
        assert!(super::custom_trades(trader_index));

        for base in [
            PolicyKind::RandomLegal,
            PolicyKind::PriorityTrader,
            PolicyKind::HeuristicV1Noports,
            plain,
        ] {
            assert!(
                register_custom_policy(base, "rejected@family-test".into(), &source).is_err(),
                "{base:?} must be rejected as a base"
            );
        }
    }

    #[test]
    fn re_registration_dedupes_and_conflicts_error() {
        let source = serde_json::to_string(&composite_defaults()).expect("serialize");
        let name = "composite@dedupe-test".to_string();
        let base = PolicyKind::HeuristicV1TraderAwareThreatDevcardsDenial;
        let first = register_custom_policy(base, name.clone(), &source).expect("registers");
        let second = register_custom_policy(base, name.clone(), &source).expect("re-registers");
        assert_eq!(first, second);

        let changed = serde_json::to_string(&HeuristicParams {
            production_weight: 3.0,
            ..composite_defaults()
        })
        .expect("serialize");
        let error = register_custom_policy(base, name, &changed).expect_err("conflict");
        assert!(error.contains("different params"), "{error}");
    }

    /// Walks the committed sweep-bounds file against the live shapes: every swept policy
    /// parameter has a declared range whose endpoints pass the loader (domain guards and
    /// the SIM-GAP-30 headroom check), every placement weight has a range whose endpoints
    /// pass `EngineWeights::validate` (the `genericPortFactor >= 0` hard bound included),
    /// and both sections are complete in both directions so a parameter cannot be added
    /// without declaring its candidate range.
    #[test]
    fn the_sweep_bounds_file_is_complete_and_every_endpoint_admissible() {
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");

        // Policy section against the params shape (legacyValuation and specialBuild are
        // pinned by the loader, not swept).
        let base = composite_value();
        let mut policy_paths = Vec::new();
        collect_leaf_paths(&base, "", &mut policy_paths);
        policy_paths.retain(|path| path != "/legacyValuation" && path != "/specialBuild");
        for path in &policy_paths {
            let range = bounds["policy"]
                .pointer(path)
                .unwrap_or_else(|| panic!("bounds.policy is missing {path}"));
            for endpoint in ["min", "max"] {
                let value = range[endpoint].clone();
                assert!(value.is_number(), "{path}.{endpoint} is a number");
                let mut candidate = base.clone();
                *candidate.pointer_mut(path).expect("path exists") = value;
                parse_params_file(&candidate.to_string()).unwrap_or_else(|error| {
                    panic!("bounds.policy{path} {endpoint} endpoint must load: {error}")
                });
            }
        }
        let mut declared = Vec::new();
        collect_range_paths(&bounds["policy"], "", &mut declared);
        for path in &declared {
            assert!(
                policy_paths.contains(path),
                "bounds.policy{path} names no swept parameter"
            );
        }

        // Placement section against default-weights.json.
        let weights_base: Value = serde_json::from_str(
            &std::fs::read_to_string(DEFAULT_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");
        let mut weight_paths = Vec::new();
        collect_leaf_paths(&weights_base, "", &mut weight_paths);
        for path in &weight_paths {
            let range = bounds["placement"]
                .pointer(path)
                .unwrap_or_else(|| panic!("bounds.placement is missing {path}"));
            for endpoint in ["min", "max"] {
                let value = range[endpoint].clone();
                assert!(value.is_number(), "{path}.{endpoint} is a number");
                let mut candidate = weights_base.clone();
                *candidate.pointer_mut(path).expect("path exists") = value;
                let weights: EngineWeights =
                    serde_json::from_value(candidate).expect("weights shape");
                weights.validate().unwrap_or_else(|error| {
                    panic!("bounds.placement{path} {endpoint} endpoint must validate: {error}")
                });
            }
        }
        let mut declared = Vec::new();
        collect_range_paths(&bounds["placement"], "", &mut declared);
        for path in &declared {
            assert!(
                weight_paths.contains(path),
                "bounds.placement{path} names no placement weight"
            );
        }
        assert!(
            bounds["placement"]["genericPortFactor"]["min"]
                .as_f64()
                .expect("number")
                >= 0.0,
            "the genericPortFactor hard bound is >= 0"
        );

        // TradeConfig section against the live struct's shape; ranges must stay inside
        // the flags' obvious domain (non-negative, min <= max).
        let trade_shape = round_trip(&TradeConfig::default());
        let mut trade_paths = Vec::new();
        collect_leaf_paths(&trade_shape, "", &mut trade_paths);
        for path in &trade_paths {
            let range = bounds["tradeConfig"]
                .pointer(path)
                .unwrap_or_else(|| panic!("bounds.tradeConfig is missing {path}"));
            let min = range["min"].as_f64().expect("number");
            let max = range["max"].as_f64().expect("number");
            assert!(
                min.is_finite() && max.is_finite() && 0.0 <= min && min <= max,
                "{path}"
            );
        }
        let mut declared = Vec::new();
        collect_range_paths(&bounds["tradeConfig"], "", &mut declared);
        for path in &declared {
            assert!(
                trade_paths.contains(path),
                "bounds.tradeConfig{path} names no trade flag"
            );
        }
    }

    /// Walks the committed H2 screen arms (`placement/arms/h2_*.json` plus the `h2x_*`
    /// extension arms): every file loads through the full contract (exact keys, guards,
    /// headroom), differs from the composite defaults in exactly one leaf, and that leaf
    /// sits inside its committed sweep-bounds range. The counts pin the preregistered
    /// 64-parameter x 2-arm M-41 set and the 10-arm M-42 extension set.
    #[test]
    fn the_h2_arm_files_are_single_parameter_perturbations_inside_bounds() {
        let arms_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        let base = composite_value();
        let mut leaves = Vec::new();
        collect_leaf_paths(&base, "", &mut leaves);
        let mut screen_count = 0;
        let mut extension_count = 0;
        for entry in std::fs::read_dir(arms_dir).expect("arms dir") {
            let path = entry.expect("entry").path();
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();
            if !name.ends_with(".json") {
                continue;
            }
            if name.starts_with("h2_") {
                screen_count += 1;
            } else if name.starts_with("h2x_") {
                extension_count += 1;
            } else {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("arm file");
            parse_params_file(&source)
                .unwrap_or_else(|error| panic!("{name} must load: {error}"));
            let file: Value = serde_json::from_str(&source).expect("valid JSON");
            let changed: Vec<&String> = leaves
                .iter()
                .filter(|leaf| file.pointer(leaf) != base.pointer(leaf))
                .collect();
            assert_eq!(
                changed.len(),
                1,
                "{name} must perturb exactly one parameter, got {changed:?}"
            );
            let leaf = changed[0];
            let range = bounds["policy"]
                .pointer(leaf)
                .unwrap_or_else(|| panic!("{name}: no bounds range for {leaf}"));
            let value = file.pointer(leaf).expect("leaf").as_f64().expect("number");
            assert!(
                range["min"].as_f64().expect("number") <= value
                    && value <= range["max"].as_f64().expect("number"),
                "{name}: {leaf} = {value} lies outside its bounds range"
            );
        }
        assert_eq!(screen_count, 128, "the H2 screen commits 64 parameters x 2 arms");
        assert_eq!(extension_count, 10, "the M-42 extension commits 10 arms");
    }

    #[test]
    fn a_negative_generic_port_factor_fails_placement_validation() {
        let mut weights: Value = serde_json::from_str(
            &std::fs::read_to_string(DEFAULT_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");
        weights["genericPortFactor"] = Value::from(-0.1);
        let weights: EngineWeights = serde_json::from_value(weights).expect("weights shape");
        let error = weights.validate().expect_err("hard bound");
        assert!(error.contains("genericPortFactor >= 0"), "{error}");
    }

    /// Collects `/a/b`-style JSON pointers to every non-object leaf, descending into
    /// objects (a `null` gate is itself a leaf and is skipped by callers via retain).
    fn collect_leaf_paths(value: &Value, path: &str, into: &mut Vec<String>) {
        match value.as_object() {
            Some(object) => {
                for (key, child) in object {
                    collect_leaf_paths(child, &format!("{path}/{key}"), into);
                }
            }
            None => into.push(path.to_string()),
        }
    }

    /// Collects pointers to every `{min, max}` range object in a bounds section.
    fn collect_range_paths(value: &Value, path: &str, into: &mut Vec<String>) {
        let Some(object) = value.as_object() else {
            return;
        };
        if object.contains_key("min") && object.contains_key("max") {
            into.push(path.to_string());
            return;
        }
        for (key, child) in object {
            collect_range_paths(child, &format!("{path}/{key}"), into);
        }
    }
}
