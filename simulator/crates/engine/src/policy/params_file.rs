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
    /// The shipped placement vector as it stood before the SP6 adoption (M-66) moved
    /// `expansionWeight` off 0. Every SP-family arm file is the *pre-adoption* defaults with
    /// one axis perturbed, and each is a measurement record cited by a committed M entry, so
    /// their pins anchor here rather than to the live defaults, the way the H-family pins
    /// anchor to `screen_baseline_value`.
    const SP6_PRE_ADOPTION_WEIGHTS_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../placement/sp6-pre-adoption-weights.json"
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

    /// The composite defaults the H screens and combines were generated against,
    /// before the Phase-I adoption (M-46) moved the four winning axes into
    /// `Default::default()`. The committed `h2_*`/`h2x_*`/`h4_*` arm files are
    /// measurement records of that baseline: their measured axis values never move,
    /// though their bytes do, since the exact-key contract makes every arm file gain a
    /// key whenever a parameter is added. That is why their pins anchor to a
    /// reconstructed baseline rather than to the live defaults.
    fn screen_baseline_value() -> Value {
        let mut base = composite_value();
        for (leaf, pre_adoption) in [
            ("/devBuyScale", 1.0),
            ("/trading/etwWeight", 1.0),
            ("/trading/dangerFloor", 1.0),
            ("/trading/dangerWeight", 0.5),
        ] {
            *base.pointer_mut(leaf).expect("leaf") = Value::from(pre_adoption);
        }
        base
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
        let error = register_custom_policy(base, name.clone(), &changed).expect_err("conflict");
        assert!(error.contains("different params"), "{error}");

        // Same name and identical params under a different base family: the stored
        // `trades` flag differs, so accepting it would let one arm label mean two
        // dispatch families across runs.
        let error =
            register_custom_policy(PolicyKind::HeuristicV1, name, &source).expect_err("family");
        assert!(error.contains("different params"), "{error}");
    }

    /// One known-bad value per domain-constrained leaf, complete in both directions
    /// against the live composite shape: silently dropping any sign or range guard from
    /// `validate_params` or a block `validate` fails here, and a new params field cannot
    /// land without declaring whether it has a JSON-expressible bad value. `None` marks
    /// fields whose only constraint is finiteness: JSON cannot spell a non-finite
    /// number (serde_json rejects `1e999` and has no NaN literal), so those guards are
    /// unreachable through the loader and only back the engine's debug asserts.
    #[test]
    fn every_domain_guard_rejects_its_bad_value() {
        let float = |value: f64| Some(Value::from(value));
        let int = |value: u8| Some(Value::from(value));
        let bad_values: Vec<(&str, Option<Value>)> = vec![
            ("/productionWeight", None),
            ("/scarcityWeight", None),
            ("/diversityBonus", None),
            ("/portWeight", None),
            ("/expansionWeight", None),
            ("/robberBlockThreshold", None),
            ("/shedWeight", float(-1.0)),
            ("/goalNeedWeight", float(-1.0)),
            ("/stageExpansionWeight", float(-1.0)),
            ("/stageCityWeight", float(-1.0)),
            ("/stageUrgencyWeight", float(-1.0)),
            ("/slotReturnWeight", float(-1.0)),
            ("/costPressureWeight", float(-1.0)),
            ("/frontierMix", float(1.5)),
            ("/devBuyScale", float(-1.0)),
            ("/goalHysteresisMargin", float(-1.0)),
            ("/threat/delayWeight", None),
            ("/threat/needWeight", None),
            ("/threat/needCompletionWeight", float(-1.0)),
            ("/threat/blockWeight", None),
            ("/threat/stealWeight", float(-1.0)),
            ("/threat/victimHandWeight", float(-1.0)),
            ("/threat/victimNeedWeight", float(-1.0)),
            ("/threat/dangerFloor", float(0.0)),
            ("/threat/delayCap", float(-1.0)),
            ("/threat/handCap", float(0.0)),
            ("/threat/knightStealWeight", float(-1.0)),
            ("/threat/knightPlacementWeight", float(-1.0)),
            ("/threat/knightReliefWeight", float(-1.0)),
            ("/devCards/etwWeight", None),
            ("/devCards/etwFloor", float(0.0)),
            ("/devCards/gainCap", float(-1.0)),
            ("/devCards/completionWeight", None),
            ("/devCards/holdDiscount", float(-1.0)),
            ("/devCards/haulGrowth", float(-1.0)),
            ("/devCards/monopolySoundFloor", float(-1.0)),
            ("/devCards/tempoWeight", None),
            ("/devCards/tempoHalf", float(0.0)),
            ("/devCards/exposureWeight", float(-1.0)),
            ("/trading/etwWeight", None),
            ("/trading/etwFloor", float(0.0)),
            ("/trading/gainCap", float(-1.0)),
            ("/trading/tempoWeight", None),
            ("/trading/tempoHalf", float(0.0)),
            ("/trading/scarcityFloor", float(0.0)),
            ("/trading/dangerFloor", float(0.0)),
            ("/trading/dangerWeight", None),
            ("/trading/benefitWeight", None),
            ("/trading/marginScale", float(0.0)),
            ("/trading/offerGainWeight", None),
            ("/trading/offerBase", None),
            ("/trading/offerSpan", None),
            ("/denial/dangerFloor", float(0.0)),
            ("/denial/pressureFloor", float(-1.0)),
            ("/denial/pressureSpan", float(-1.0)),
            ("/denial/raceBonus", float(-1.0)),
            ("/denial/raceDangerMin", float(1.5)),
            ("/denial/raceCheckCap", int(0)),
            ("/denial/defendWeight", float(-1.0)),
            ("/denial/defendHeadroomHalf", float(0.0)),
            ("/denial/defendProbeSlack", int(0)),
            ("/denial/contestWeight", float(-1.0)),
            ("/denial/contestCap", float(-1.0)),
            ("/denial/contestBlockBonus", float(-1.0)),
            ("/denial/contestGoalShare", float(-1.0)),
            ("/denial/armyDefendWeight", float(-1.0)),
            ("/denial/armyGapHalf", float(0.0)),
        ];
        let base = composite_value();
        let mut leaves = Vec::new();
        collect_leaf_paths(&base, "", &mut leaves);
        leaves.retain(|path| path != "/legacyValuation" && path != "/specialBuild");
        for leaf in &leaves {
            assert!(
                bad_values.iter().any(|(path, _)| path == leaf),
                "{leaf} has no bad-value declaration"
            );
        }
        for (path, bad) in bad_values {
            assert!(leaves.contains(&path.to_string()), "{path} names no leaf");
            let Some(bad) = bad else { continue };
            let mut candidate = base.clone();
            *candidate.pointer_mut(path).expect("path exists") = bad;
            let error = parse_params_file(&candidate.to_string()).expect_err(path);
            let field = path.rsplit('/').next().expect("segment");
            assert!(error.contains(field), "{path}: {error}");
        }
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
        let base = screen_baseline_value();
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

    /// The M-50 SP1e sweep axes: JSON pointer and arm slug. Five axes, two arms each,
    /// every arm sitting on its declared sweep-bounds endpoint.
    const SP1E_AXES: [(&str, &str); 5] = [
        ("/threat/knightStealWeight", "knsteal"),
        ("/threat/knightPlacementWeight", "knplace"),
        ("/threat/knightReliefWeight", "knrelief"),
        ("/threat/victimNeedWeight", "victimneed"),
        ("/threat/needCompletionWeight", "needcomp"),
    ];

    /// Walks the committed SP1e sweep arms (`placement/arms/sp1e_*.json`): each file
    /// loads through the full contract, differs from the *post-SP1 live* composite
    /// defaults in exactly one leaf, and carries that leaf's bounds endpoint exactly:
    /// `_lo` the `min`, `_hi` the `max`. The H2 walk anchors to the pre-adoption
    /// baseline its frozen files were generated against; SP1e is a new sweep, so it
    /// anchors to the defaults it will actually be measured against.
    #[test]
    fn the_sp1e_arm_files_are_the_committed_bounds_endpoint_perturbations() {
        let arms_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        let base = composite_value();

        let mut expected = Vec::new();
        for (leaf, slug) in SP1E_AXES {
            let range = bounds["policy"]
                .pointer(leaf)
                .unwrap_or_else(|| panic!("no bounds range for {leaf}"));
            for (endpoint, suffix) in [("min", "lo"), ("max", "hi")] {
                let name = format!("sp1e_{slug}_{suffix}.json");
                let source = std::fs::read_to_string(format!("{arms_dir}/{name}"))
                    .unwrap_or_else(|_| panic!("{name} must be committed"));
                parse_params_file(&source)
                    .unwrap_or_else(|error| panic!("{name} must load: {error}"));
                let file: Value = serde_json::from_str(&source).expect("valid JSON");

                let mut perturbed = base.clone();
                *perturbed.pointer_mut(leaf).expect("leaf") = range[endpoint].clone();
                assert_eq!(
                    file, perturbed,
                    "{name} must be the post-SP1 defaults with {leaf} at its {endpoint} bound"
                );
                expected.push(name);
            }
        }

        // No stray sp1e_ file: an arm nobody preregistered would silently join a run.
        let mut found = Vec::new();
        for entry in std::fs::read_dir(arms_dir).expect("arms dir") {
            let name = entry.expect("entry").file_name().to_string_lossy().into_owned();
            if name.starts_with("sp1e_") {
                found.push(name);
            }
        }
        found.sort();
        expected.sort();
        assert_eq!(found, expected, "the SP1e sweep commits 5 axes x 2 arms");
    }

    /// The four axes M-46 adopted, as JSON pointer, arm slug and the value the axis
    /// carried before the adoption. The pre-adoption values are the ones
    /// `screen_baseline_value` restores; M-51 reverts them one at a time to ask whether
    /// the adoption still reads the same way against the post-SP1 field.
    const SP1R_REVERTS: [(&str, &str, f64); 4] = [
        ("/devBuyScale", "devbuy", 1.0),
        ("/trading/etwWeight", "tretw", 1.0),
        ("/trading/dangerFloor", "trfloor", 1.0),
        ("/trading/dangerWeight", "trdangerw", 0.5),
    ];

    /// Walks the committed M-51 re-screen arms (`placement/arms/sp1r_*.json`): each file
    /// loads through the full contract, is the *post-SP1 live* composite defaults with
    /// exactly one adopted axis put back to its pre-adoption value, and that value sits
    /// inside the axis's committed sweep-bounds range. The M-51 run also carries a fifth
    /// arm on the weights side, which needs no file of its own: it is the committed
    /// `phase-i-candidate-weights.json`, already pinned as the defaults with
    /// `handValueWeight` at its pre-drop 0.4 by
    /// `the_phase_i_candidate_files_record_the_adopted_vectors`.
    #[test]
    fn the_sp1r_arm_files_are_the_committed_pre_adoption_reverts() {
        let arms_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        let base = composite_value();
        let baseline = screen_baseline_value();

        let mut expected = Vec::new();
        for (leaf, slug, pre_adoption) in SP1R_REVERTS {
            assert_eq!(
                baseline.pointer(leaf).expect("leaf").as_f64(),
                Some(pre_adoption),
                "{leaf}: the revert value must be the pre-adoption baseline the H screens ran on"
            );
            let range = bounds["policy"]
                .pointer(leaf)
                .unwrap_or_else(|| panic!("no bounds range for {leaf}"));
            assert!(
                range["min"].as_f64().expect("number") <= pre_adoption
                    && pre_adoption <= range["max"].as_f64().expect("number"),
                "{leaf}: revert value {pre_adoption} lies outside its bounds range"
            );

            let name = format!("sp1r_{slug}.json");
            let source = std::fs::read_to_string(format!("{arms_dir}/{name}"))
                .unwrap_or_else(|_| panic!("{name} must be committed"));
            parse_params_file(&source).unwrap_or_else(|error| panic!("{name} must load: {error}"));
            let file: Value = serde_json::from_str(&source).expect("valid JSON");

            let mut reverted = base.clone();
            *reverted.pointer_mut(leaf).expect("leaf") = Value::from(pre_adoption);
            assert_eq!(
                file, reverted,
                "{name} must be the post-SP1 defaults with {leaf} back at {pre_adoption}"
            );
            expected.push(name);
        }

        // No stray sp1r_ file: an arm nobody preregistered would silently join the run.
        let mut found = Vec::new();
        for entry in std::fs::read_dir(arms_dir).expect("arms dir") {
            let name = entry.expect("entry").file_name().to_string_lossy().into_owned();
            if name.starts_with("sp1r_") {
                found.push(name);
            }
        }
        found.sort();
        expected.sort();
        assert_eq!(found, expected, "the M-51 re-screen commits one arm per adopted axis");
    }

    /// The M-44 H4 combine winners: JSON pointer, slug of the committed revert arm, and
    /// the winner value. Preregistered in the M-44 prereg; the values are the largest
    /// `better` estimate per axis from M-41/M-42.
    const H4_WINNERS: [(&str, &str, f64); 9] = [
        ("/devBuyScale", "devbuy", 0.25),
        ("/trading/etwWeight", "tretw", 4.0),
        ("/trading/tempoWeight", "trtempo", 0.8),
        ("/trading/benefitWeight", "trbenefit", 2.0),
        ("/trading/marginScale", "trmargin", 24.0),
        ("/trading/offerBase", "trofferbase", 700.0),
        ("/trading/tempoHalf", "trtempohalf", 1.0),
        ("/trading/dangerFloor", "trfloor", 4.0),
        ("/trading/dangerWeight", "trdangerw", 2.0),
    ];

    /// Pins the committed H4 combine set: `h4_combined.json` is the composite defaults
    /// with exactly the nine preregistered winner leaves moved, each `h4_no_<slug>.json`
    /// is the combined vector with that one winner reverted to its default, and every
    /// file loads through the full contract (exact keys, guards, headroom; the load is
    /// H4's mechanical headroom re-check). Every winner value sits inside its committed
    /// sweep-bounds range.
    #[test]
    fn the_h4_arm_files_are_the_committed_combine_vectors() {
        let arms_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        let defaults = screen_baseline_value();
        let mut combined = defaults.clone();
        for (leaf, _, winner) in H4_WINNERS {
            let range = bounds["policy"]
                .pointer(leaf)
                .unwrap_or_else(|| panic!("no bounds range for {leaf}"));
            assert!(
                range["min"].as_f64().expect("number") <= winner
                    && winner <= range["max"].as_f64().expect("number"),
                "{leaf} winner {winner} lies outside its bounds range"
            );
            *combined.pointer_mut(leaf).expect("leaf") = Value::from(winner);
        }

        let read = |name: &str| -> Value {
            let source =
                std::fs::read_to_string(format!("{arms_dir}/{name}")).expect("committed arm");
            parse_params_file(&source).unwrap_or_else(|error| panic!("{name} must load: {error}"));
            serde_json::from_str(&source).expect("valid JSON")
        };
        assert_eq!(read("h4_combined.json"), combined, "h4_combined.json drifted");
        for (leaf, slug, _) in H4_WINNERS {
            let mut revert = combined.clone();
            *revert.pointer_mut(leaf).expect("leaf") =
                defaults.pointer(leaf).expect("default").clone();
            assert_eq!(
                read(&format!("h4_no_{slug}.json")),
                revert,
                "h4_no_{slug}.json drifted"
            );
        }

        // The final vector after the M-44 coordinate pass: the preregistered rule kept
        // four winners (removal `worse`-leaning or `inconclusive`) and reverted five
        // (removal `better` or `equivalent`).
        let kept = [
            "/devBuyScale",
            "/trading/etwWeight",
            "/trading/dangerFloor",
            "/trading/dangerWeight",
        ];
        let mut final_vector = defaults.clone();
        for (leaf, _, winner) in H4_WINNERS {
            if kept.contains(&leaf) {
                *final_vector.pointer_mut(leaf).expect("leaf") = Value::from(winner);
            }
        }
        assert_eq!(read("h4_final.json"), final_vector, "h4_final.json drifted");
    }

    /// Pins the Phase-I outcome (M-46, gate `better` at +14.10pp, adopted): the
    /// candidate params are now byte-shape-identical to the *live* composite defaults
    /// (adoption moved the four winning axes into `Default::default()`) and still match
    /// the confirmed `h4_final.json` record. The candidate weights file is the placement
    /// snapshot Phase I ran on: identical to the pre-adoption placement vector except
    /// `handValueWeight`, where adoption applied the M-43 drop (0.4 → 0). Its weights half
    /// is anchored to `sp6-pre-adoption-weights.json` rather than to the live defaults for
    /// the same reason the SP-family arm pins are: the SP6 adoption moved
    /// `expansionWeight`, which this record predates.
    #[test]
    fn the_phase_i_candidate_files_record_the_adopted_vectors() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let params_source =
            std::fs::read_to_string(format!("{placement_dir}/phase-i-candidate-params.json"))
                .expect("committed candidate params");
        parse_params_file(&params_source).expect("candidate params load");
        let params: Value = serde_json::from_str(&params_source).expect("valid JSON");
        let final_source = std::fs::read_to_string(format!("{placement_dir}/arms/h4_final.json"))
            .expect("committed final vector");
        assert_eq!(
            params,
            serde_json::from_str::<Value>(&final_source).expect("valid JSON"),
            "candidate params drifted from the confirmed h4_final.json vector"
        );
        assert_eq!(
            params,
            composite_value(),
            "the adopted defaults drifted from the gate-confirmed candidate"
        );

        let weights_source =
            std::fs::read_to_string(format!("{placement_dir}/phase-i-candidate-weights.json"))
                .expect("committed candidate weights");
        let weights: EngineWeights =
            serde_json::from_str(&weights_source).expect("weights shape");
        weights.validate().expect("candidate weights validate");
        let mut candidate: Value = serde_json::from_str(&weights_source).expect("valid JSON");
        assert_eq!(
            candidate["handValueWeight"],
            Value::from(0.4),
            "the candidate snapshot carries the pre-drop handValueWeight"
        );
        candidate["handValueWeight"] = Value::from(0);
        let pre_adoption_source =
            std::fs::read_to_string(SP6_PRE_ADOPTION_WEIGHTS_PATH).expect("pre-adoption defaults");
        assert_eq!(
            candidate,
            serde_json::from_str::<Value>(&pre_adoption_source).expect("valid JSON"),
            "the pre-adoption vector must differ from the candidate snapshot only in the adopted handValue drop"
        );
    }

    /// SP1d promoted the knight's own-tile relief constant to a swept axis, so the loader
    /// owes it the same rejection every other declared threat weight gets: a bad vector must
    /// fail at load rather than trip a debug assert mid-run.
    #[test]
    fn a_negative_knight_relief_weight_fails_the_loader() {
        let mut file = composite_value();
        file["threat"]["knightReliefWeight"] = Value::from(-1.0);
        let error = parse_params_file(&file.to_string()).expect_err("negative relief weight");
        assert!(error.contains("threat.knightReliefWeight"), "{error}");

        let mut file = composite_value();
        file["threat"]["knightReliefWeight"] = Value::from(0.0);
        parse_params_file(&file.to_string()).expect("zero is inside the domain");
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

    /// `port_deficit_factor` is `1 + w * d` with `d` in [0, 1], so a weight below -1 makes the
    /// whole port term negative and the scorer starts preferring portless vertices. Same hard
    /// bound, and same reason, as `genericPortFactor`.
    #[test]
    fn a_negative_port_coverage_deficit_weight_fails_placement_validation() {
        let mut weights: Value = serde_json::from_str(
            &std::fs::read_to_string(DEFAULT_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");
        weights["portCoverageDeficitWeight"] = Value::from(-0.1);
        let parsed: EngineWeights =
            serde_json::from_value(weights.clone()).expect("weights shape");
        let error = parsed.validate().expect_err("hard bound");
        assert!(error.contains("portCoverageDeficitWeight >= 0"), "{error}");

        weights["portCoverageDeficitWeight"] = Value::from(0.0);
        let parsed: EngineWeights = serde_json::from_value(weights).expect("weights shape");
        parsed.validate().expect("zero is inside the domain");
    }

    /// The term charges for a rise in the top hex's share, so a negative weight pays a pair for
    /// concentrating its income on one blockable hex, which is the opposite of the direction M-56
    /// read. Same hard bound, and same reason, as `genericPortFactor`.
    #[test]
    fn a_negative_robber_concentration_weight_fails_placement_validation() {
        let mut weights: Value = serde_json::from_str(
            &std::fs::read_to_string(DEFAULT_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");
        weights["robberConcentrationWeight"] = Value::from(-0.1);
        let parsed: EngineWeights =
            serde_json::from_value(weights.clone()).expect("weights shape");
        let error = parsed.validate().expect_err("hard bound");
        assert!(error.contains("robberConcentrationWeight >= 0"), "{error}");

        weights["robberConcentrationWeight"] = Value::from(0.0);
        let parsed: EngineWeights = serde_json::from_value(weights).expect("weights shape");
        parsed.validate().expect("zero is inside the domain");
    }

    /// The credit pays the hero for what a candidate costs the rivals picking before its second
    /// settlement, and that cost is already floored at 0, so a negative weight pays the hero to
    /// hand rivals the sites they want most. Same hard bound as the other placement weights.
    #[test]
    fn a_negative_setup_denial_weight_fails_placement_validation() {
        let mut weights: Value = serde_json::from_str(
            &std::fs::read_to_string(DEFAULT_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");
        weights["setupDenialWeight"] = Value::from(-0.1);
        let parsed: EngineWeights =
            serde_json::from_value(weights.clone()).expect("weights shape");
        let error = parsed.validate().expect_err("hard bound");
        assert!(error.contains("setupDenialWeight >= 0"), "{error}");

        weights["setupDenialWeight"] = Value::from(0.0);
        let parsed: EngineWeights = serde_json::from_value(weights).expect("weights shape");
        parsed.validate().expect("zero is inside the domain");
    }

    /// The term is `expansionWeight * top-two of the sites a candidate opens`, so a negative
    /// weight pays a boxed-in candidate, which scores 0, more than an open one. Same hard bound,
    /// and same reason, as `genericPortFactor`.
    #[test]
    fn a_negative_expansion_weight_fails_placement_validation() {
        let mut weights: Value = serde_json::from_str(
            &std::fs::read_to_string(DEFAULT_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");
        weights["expansionWeight"] = Value::from(-0.1);
        let parsed: EngineWeights =
            serde_json::from_value(weights.clone()).expect("weights shape");
        let error = parsed.validate().expect_err("hard bound");
        assert!(error.contains("expansionWeight >= 0"), "{error}");

        weights["expansionWeight"] = Value::from(0.0);
        let parsed: EngineWeights = serde_json::from_value(weights).expect("weights shape");
        parsed.validate().expect("zero is inside the domain");
    }

    /// The decay is charged once per paid road-build, so above 1 a site three roads out outscores
    /// the same site next door, and below 0 the term's sign alternates with distance. Both ends
    /// are closed, unlike the one-sided bounds the weights carry, so both ends are checked.
    #[test]
    fn an_expansion_decay_outside_the_unit_interval_fails_placement_validation() {
        let committed: Value = serde_json::from_str(
            &std::fs::read_to_string(DEFAULT_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");
        for outside in [-0.1, 1.1] {
            let mut weights = committed.clone();
            weights["expansionDecay"] = Value::from(outside);
            let parsed: EngineWeights = serde_json::from_value(weights).expect("weights shape");
            let error = parsed.validate().expect_err("hard bound");
            assert!(error.contains("expansionDecay in [0, 1]"), "{error}");
        }
        for inside in [0.0, 0.5, 1.0] {
            let mut weights = committed.clone();
            weights["expansionDecay"] = Value::from(inside);
            let parsed: EngineWeights = serde_json::from_value(weights).expect("weights shape");
            parsed.validate().expect("the closed unit interval is the domain");
        }
    }

    /// `slotScales` is keyed by seat count and slot, so a dropped or misspelled key is a silent
    /// no-op rather than a load error unless the block is checked for exact keys: a file missing
    /// the four-seat slot 3 entry would score the last pick of every measured run unscaled and
    /// read as the reference arm. The scales multiply components, so a negative one flips a whole
    /// term's sign and is outside the range `sweep-bounds.json` declares.
    #[test]
    fn a_malformed_slot_scales_block_fails_placement_validation() {
        let committed: Value = serde_json::from_str(
            &std::fs::read_to_string(DEFAULT_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");
        let parsed: EngineWeights =
            serde_json::from_value(committed.clone()).expect("weights shape");
        parsed.validate().expect("the shipped block is exact");

        let mut missing_slot = committed.clone();
        missing_slot["slotScales"]["4"]
            .as_object_mut()
            .expect("a seat row is an object")
            .remove("3")
            .expect("the four-seat block carries slot 3");
        let parsed: EngineWeights =
            serde_json::from_value(missing_slot).expect("weights shape");
        let error = parsed.validate().expect_err("a missing slot is a load error");
        assert!(error.contains("slotScales.4 carries slots"), "{error}");

        let mut extra_seats = committed.clone();
        extra_seats["slotScales"]["7"] = committed["slotScales"]["6"].clone();
        let parsed: EngineWeights = serde_json::from_value(extra_seats).expect("weights shape");
        let error = parsed
            .validate()
            .expect_err("an extra seat count is a load error");
        assert!(error.contains("slotScales carries seat counts"), "{error}");

        let mut negative = committed.clone();
        negative["slotScales"]["4"]["2"]["diversity"] = Value::from(-0.5);
        let parsed: EngineWeights = serde_json::from_value(negative).expect("weights shape");
        let error = parsed.validate().expect_err("a negative scale is a load error");
        assert!(
            error.contains("slotScales.4.2.diversity >= 0 and finite"),
            "{error}"
        );

        // The same guard's other half. JSON has no literal for it, so the field is set after the
        // parse: a non-finite scale multiplies a whole component into NaN, which loses every
        // comparison in the argmax instead of failing.
        let mut not_finite: EngineWeights =
            serde_json::from_value(committed).expect("weights shape");
        not_finite
            .slot_scales
            .get_mut("4")
            .expect("the four-seat row")
            .get_mut("2")
            .expect("slot 2")
            .expansion = f64::NAN;
        let error = not_finite
            .validate()
            .expect_err("a non-finite scale is a load error");
        assert!(
            error.contains("slotScales.4.2.expansion >= 0 and finite"),
            "{error}"
        );
    }

    /// `robber_choice`'s joint argmax only agrees with the two-stage search it replaced where the
    /// steal term cannot go negative, and both of these scale it.
    #[test]
    fn a_negative_steal_or_victim_hand_weight_fails_the_loader() {
        for key in ["stealWeight", "victimHandWeight"] {
            let mut file = composite_value();
            file["threat"][key] = Value::from(-0.1);
            let error = parse_params_file(&file.to_string())
                .err()
                .unwrap_or_else(|| panic!("negative {key} must fail at load"));
            assert!(error.contains(&format!("threat.{key}")), "{error}");

            let mut file = composite_value();
            file["threat"][key] = Value::from(0.0);
            parse_params_file(&file.to_string()).expect("zero is inside the domain");
        }
    }

    /// The two SP2 term arms, as weights key, arm file stem and the value the arm carries.
    /// Both terms ship at 0, so an arm is the pre-adoption defaults with its own term switched on.
    const SP2_ARMS: [(&str, &str, f64); 2] = [
        ("recipeDevCardBonus", "sp2a_devcard", 1.0),
        ("portCoverageDeficitWeight", "sp2b_portdeficit", 1.0),
    ];

    /// Walks the committed SP2 term arms (`placement/arms/sp2*.json`): each is the live
    /// `default-weights.json` with exactly one new weight raised, and that value sits inside
    /// the axis's committed sweep-bounds range. The weights-file walk below only proves these
    /// load; without this an edit that also moved `portWeight` would run and be recorded as an
    /// isolated port-deficit A/B. The stray-file check is the same one the SP1e walk carries:
    /// an arm nobody preregistered would silently join a run.
    #[test]
    fn the_sp2_arm_files_are_the_committed_single_term_perturbations() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let arms_dir = format!("{placement_dir}/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        // Frozen at the pre-adoption field: these arms are measurement records, and the
        // SP6 adoption moved the live defaults out from under them.
        let base: Value = serde_json::from_str(
            &std::fs::read_to_string(SP6_PRE_ADOPTION_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");

        let mut expected = Vec::new();
        for (key, stem, value) in SP2_ARMS {
            let name = format!("{stem}.json");
            let source = std::fs::read_to_string(format!("{arms_dir}/{name}"))
                .unwrap_or_else(|_| panic!("{name} must be committed"));
            let weights: EngineWeights = serde_json::from_str(&source)
                .unwrap_or_else(|error| panic!("{name} must load as weights: {error}"));
            weights
                .validate()
                .unwrap_or_else(|error| panic!("{name} must validate: {error}"));

            let range = &bounds["placement"][key];
            assert!(
                value >= range["min"].as_f64().expect("min")
                    && value <= range["max"].as_f64().expect("max"),
                "{name}: {key} at {value} must sit inside its committed sweep-bounds range"
            );
            assert_eq!(
                base[key].as_f64(),
                Some(0.0),
                "{key} ships at 0, which is what makes the arm a single-term perturbation"
            );

            let mut perturbed = base.clone();
            perturbed[key] = Value::from(value);
            let file: Value = serde_json::from_str(&source).expect("valid JSON");
            assert_eq!(
                file, perturbed,
                "{name} must be the pre-adoption defaults with {key} at {value} and nothing else moved"
            );
            expected.push(name);
        }

        let mut found = Vec::new();
        for entry in std::fs::read_dir(&arms_dir).expect("arms dir") {
            let name = entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("sp2") {
                found.push(name);
            }
        }
        found.sort();
        expected.sort();
        assert_eq!(found, expected, "the SP2 phase commits one arm per term");
    }

    /// The SP3 arms, as arm file stem and the weights keys that arm moves off the pre-adoption defaults.
    /// A table of overrides rather than SP2's single key, because the phase's conditional decay
    /// arms would have moved two axes at once: the surviving `expansionWeight` and
    /// `expansionDecay`. M-54 read no survivor, so they never existed, and the phase's third arm
    /// is on the unrelated concentration axis M-56 opened.
    const SP3_ARMS: [(&str, &[(&str, f64)]); 3] = [
        ("sp3_expansion_lo", &[("expansionWeight", 0.1)]),
        ("sp3_expansion_hi", &[("expansionWeight", 0.3)]),
        ("sp3_concentration", &[("robberConcentrationWeight", 4.0)]),
    ];

    /// Walks the committed SP3 arms (`placement/arms/sp3*.json`) as the SP2 walk above walks its
    /// own: each is `sp6-pre-adoption-weights.json` with only its declared keys moved, each moved
    /// value differs from the shipped one and sits inside that axis's committed sweep-bounds
    /// range, and no `sp3*` file nobody preregistered is sitting in the directory waiting to join
    /// a run. Without this an edit that also moved `diversityWeight` would run and be recorded as
    /// an isolated expansion A/B.
    #[test]
    fn the_sp3_arm_files_are_the_committed_expansion_perturbations() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let arms_dir = format!("{placement_dir}/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        // Frozen at the pre-adoption field: these arms are measurement records, and the
        // SP6 adoption moved the live defaults out from under them.
        let base: Value = serde_json::from_str(
            &std::fs::read_to_string(SP6_PRE_ADOPTION_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");

        let mut expected = Vec::new();
        for (stem, overrides) in SP3_ARMS {
            let name = format!("{stem}.json");
            let source = std::fs::read_to_string(format!("{arms_dir}/{name}"))
                .unwrap_or_else(|_| panic!("{name} must be committed"));
            let weights: EngineWeights = serde_json::from_str(&source)
                .unwrap_or_else(|error| panic!("{name} must load as weights: {error}"));
            weights
                .validate()
                .unwrap_or_else(|error| panic!("{name} must validate: {error}"));

            let mut perturbed = base.clone();
            for (key, value) in overrides {
                let range = &bounds["placement"][key];
                assert!(
                    *value >= range["min"].as_f64().expect("min")
                        && *value <= range["max"].as_f64().expect("max"),
                    "{name}: {key} at {value} must sit inside its committed sweep-bounds range"
                );
                assert_ne!(
                    base[key].as_f64(),
                    Some(*value),
                    "{name}: {key} at {value} is the shipped value, so the arm perturbs nothing"
                );
                perturbed[key] = Value::from(*value);
            }
            let file: Value = serde_json::from_str(&source).expect("valid JSON");
            assert_eq!(
                file, perturbed,
                "{name} must be the pre-adoption defaults with {overrides:?} and nothing else moved"
            );
            expected.push(name);
        }

        let mut found = Vec::new();
        for entry in std::fs::read_dir(&arms_dir).expect("arms dir") {
            let name = entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("sp3") {
                found.push(name);
            }
        }
        found.sort();
        expected.sort();
        assert_eq!(
            found, expected,
            "the SP3 phase commits one arm per preregistered value"
        );
    }

    /// The SP4 arms, as arm file stem and the four-seat `slotScales` leaves that arm moves off
    /// the pre-adoption defaults: slot key, component, scale. Only the four-seat row is
    /// measured, so an arm that touched the 3, 5 or 6 seat rows would be scaling entries no run
    /// of this phase exercises. Only the `diversity` component appears: on the field SP4 ran on
    /// `expansionWeight` was 0 and M-54 had read no survivor, so an `expansion` scale multiplied
    /// a term that was exactly 0. The SP6 adoption made the weight nonzero, which is why these
    /// arms are frozen records rather than a design a later phase would repeat.
    const SP4_ARMS: [(&str, &[(&str, &str, f64)]); 2] = [
        (
            "sp4_div_rise",
            &[
                ("0", "diversity", 0.5),
                ("1", "diversity", 0.8),
                ("2", "diversity", 1.25),
                ("3", "diversity", 2.0),
            ],
        ),
        (
            "sp4_div_fall",
            &[
                ("0", "diversity", 2.0),
                ("1", "diversity", 1.25),
                ("2", "diversity", 0.8),
                ("3", "diversity", 0.5),
            ],
        ),
    ];

    /// Walks the committed SP4 arms (`placement/arms/sp4*.json`) as the SP2 and SP3 walks walk
    /// theirs. An SP4 arm is a whole profile rather than a single perturbation, so the pin is on
    /// the shape of the profile: every leaf it moves is a four-seat `slotScales` leaf, each moved
    /// value sits inside that leaf's committed sweep-bounds range and differs from the shipped
    /// 1.0, and nothing else in the file moves. Without this an arm that also nudged
    /// `diversityWeight` would run and be recorded as an isolated slot-profile A/B, which is the
    /// one thing the profile contrast cannot survive: a global weight change and a slot-keyed
    /// scale change are indistinguishable in the pooled estimate.
    #[test]
    fn the_sp4_arm_files_are_the_committed_slot_profiles() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let arms_dir = format!("{placement_dir}/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        // Frozen at the pre-adoption field: these arms are measurement records, and the
        // SP6 adoption moved the live defaults out from under them.
        let base: Value = serde_json::from_str(
            &std::fs::read_to_string(SP6_PRE_ADOPTION_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");

        let mut expected = Vec::new();
        for (stem, overrides) in SP4_ARMS {
            let name = format!("{stem}.json");
            let source = std::fs::read_to_string(format!("{arms_dir}/{name}"))
                .unwrap_or_else(|_| panic!("{name} must be committed"));
            let weights: EngineWeights = serde_json::from_str(&source)
                .unwrap_or_else(|error| panic!("{name} must load as weights: {error}"));
            weights
                .validate()
                .unwrap_or_else(|error| panic!("{name} must validate: {error}"));

            let mut perturbed = base.clone();
            for (slot, component, value) in overrides {
                let range = &bounds["placement"]["slotScales"]["4"][slot][component];
                assert!(
                    *value >= range["min"].as_f64().expect("min")
                        && *value <= range["max"].as_f64().expect("max"),
                    "{name}: slotScales.4.{slot}.{component} at {value} must sit inside its committed sweep-bounds range"
                );
                assert_eq!(
                    base["slotScales"]["4"][slot][component].as_f64(),
                    Some(1.0),
                    "the block ships at 1.0 everywhere, which is what makes the arm a profile"
                );
                perturbed["slotScales"]["4"][slot][component] = Value::from(*value);
            }
            let file: Value = serde_json::from_str(&source).expect("valid JSON");
            assert_eq!(
                file, perturbed,
                "{name} must be the pre-adoption defaults with {overrides:?} and nothing else moved"
            );
            expected.push(name);
        }

        let mut found = Vec::new();
        for entry in std::fs::read_dir(&arms_dir).expect("arms dir") {
            let name = entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("sp4") {
                found.push(name);
            }
        }
        found.sort();
        expected.sort();
        assert_eq!(
            found, expected,
            "the SP4 phase commits one arm per preregistered profile"
        );
    }

    /// The two SP5 denial arms, as weights key, arm file stem and the value the arm carries. Both
    /// move the one key, at two values, because the phase asks how much of a term to price rather
    /// than which term to add: `sp5_denial_lo` is the ordinary optional-term value and
    /// `sp5_denial_hi` carries the preregistered null.
    const SP5_ARMS: [(&str, &str, f64); 2] = [
        ("setupDenialWeight", "sp5_denial_lo", 0.25),
        ("setupDenialWeight", "sp5_denial_hi", 1.0),
    ];

    /// Walks the committed SP5 arms (`placement/arms/sp5*.json`) as the SP2, SP3 and SP4 walks
    /// walk theirs: each is `sp6-pre-adoption-weights.json` with only `setupDenialWeight` raised,
    /// that value sits inside the axis's committed sweep-bounds range, and no `sp5*` file nobody
    /// preregistered is sitting in the directory waiting to join a run.
    ///
    /// The file is the hero half of an SP5 arm and nothing more. `setupDenialWeight` is read by
    /// `placement/draft.rs` alone, through the hero path of an `app_formula_draft:<hero>@<opponent>`
    /// spec, and every arm in this phase pins the opponent path to `default-weights.json`, so the
    /// weight a rival's loss is priced at never moves. Nothing in a JSON file can pin that half of
    /// the contrast; the preregistration and the committed command are where it lives.
    #[test]
    fn the_sp5_arm_files_are_the_committed_denial_perturbations() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let arms_dir = format!("{placement_dir}/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        // Frozen at the pre-adoption field: these arms are measurement records, and the
        // SP6 adoption moved the live defaults out from under them.
        let base: Value = serde_json::from_str(
            &std::fs::read_to_string(SP6_PRE_ADOPTION_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");

        let mut expected = Vec::new();
        for (key, stem, value) in SP5_ARMS {
            let name = format!("{stem}.json");
            let source = std::fs::read_to_string(format!("{arms_dir}/{name}"))
                .unwrap_or_else(|_| panic!("{name} must be committed"));
            let weights: EngineWeights = serde_json::from_str(&source)
                .unwrap_or_else(|error| panic!("{name} must load as weights: {error}"));
            weights
                .validate()
                .unwrap_or_else(|error| panic!("{name} must validate: {error}"));

            let range = &bounds["placement"][key];
            assert!(
                value >= range["min"].as_f64().expect("min")
                    && value <= range["max"].as_f64().expect("max"),
                "{name}: {key} at {value} must sit inside its committed sweep-bounds range"
            );
            assert_eq!(
                base[key].as_f64(),
                Some(0.0),
                "{key} ships at 0, which is what makes the arm a single-term perturbation"
            );

            let mut perturbed = base.clone();
            perturbed[key] = Value::from(value);
            let file: Value = serde_json::from_str(&source).expect("valid JSON");
            assert_eq!(
                file, perturbed,
                "{name} must be the pre-adoption defaults with {key} at {value} and nothing else moved"
            );
            expected.push(name);
        }

        let mut found = Vec::new();
        for entry in std::fs::read_dir(&arms_dir).expect("arms dir") {
            let name = entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("sp5") {
                found.push(name);
            }
        }
        found.sort();
        expected.sort();
        assert_eq!(
            found, expected,
            "the SP5 phase commits one arm per preregistered value"
        );
    }

    /// The six SP6 re-screen arms, as arm file stem and the weights keys that arm moves off the
    /// pre-adoption defaults. SP6 re-screens four axes SP3 through SP5 left unadopted, against the new
    /// draft-aware field, so three of these stems repeat a value an SP3 arm already carries.
    /// They are minted rather than reused because an arm file is a measurement record: an SP3
    /// file is cited by M-54 and M-57 as the vector those entries ran, and the adoption task
    /// re-anchors each phase's pin to its own pre-adoption snapshot, so a shared file would put
    /// two phases' records in one place. `sp6_diversity` could not have been reused in any case,
    /// because `h1_diversity_48.json` is anchored to the pre-drop defaults at `handValueWeight`
    /// 0.4.
    ///
    /// The decay pair moves two keys, `expansionWeight` and `expansionDecay` together, because
    /// the decay is inert at a weight of 0 and can only be read beside a nonzero weight. Both
    /// carry 0.1, the value `sp6_expansion` carries, so the decay contrast has a reference that
    /// agrees with them on every other axis; M-62's preregistration is where the condition that
    /// keeps that true lives.
    const SP6_ARMS: [(&str, &[(&str, f64)]); 6] = [
        ("sp6_expansion", &[("expansionWeight", 0.1)]),
        ("sp6_expansion_hi", &[("expansionWeight", 0.3)]),
        (
            "sp6_decay_lo",
            &[("expansionWeight", 0.1), ("expansionDecay", 0.25)],
        ),
        (
            "sp6_decay_hi",
            &[("expansionWeight", 0.1), ("expansionDecay", 1.0)],
        ),
        ("sp6_concentration", &[("robberConcentrationWeight", 4.0)]),
        ("sp6_diversity", &[("diversityWeight", 4.8)]),
    ];

    /// Walks the committed SP6 arms (`placement/arms/sp6*.json`) as the SP2 through SP5 walks
    /// walk theirs: each is `sp6-pre-adoption-weights.json` with only its declared keys moved,
    /// each moved value differs from the shipped one and sits inside that axis's committed
    /// sweep-bounds range, and no `sp6*` file nobody preregistered is sitting in the directory
    /// waiting to join a run.
    ///
    /// Each file is the hero half of an SP6 arm and nothing more. Every arm in this phase runs as
    /// `app_formula_draft:placement/arms/<stem>.json@placement/default-weights.json`, so the
    /// opponent path stays pinned to the field's own weights and the contrast moves the hero's
    /// formula alone. Nothing in a JSON file can pin that half of the contrast; the
    /// preregistration and the committed command are where it lives.
    #[test]
    fn the_sp6_arm_files_are_the_committed_rescreen_perturbations() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let arms_dir = format!("{placement_dir}/arms");
        let bounds: Value = serde_json::from_str(
            &std::fs::read_to_string(SWEEP_BOUNDS_PATH).expect("committed bounds"),
        )
        .expect("valid JSON");
        // Frozen at the pre-adoption field: these arms are measurement records, and the
        // SP6 adoption moved the live defaults out from under them.
        let base: Value = serde_json::from_str(
            &std::fs::read_to_string(SP6_PRE_ADOPTION_WEIGHTS_PATH).expect("committed weights"),
        )
        .expect("valid JSON");

        let mut expected = Vec::new();
        for (stem, overrides) in SP6_ARMS {
            let name = format!("{stem}.json");
            let source = std::fs::read_to_string(format!("{arms_dir}/{name}"))
                .unwrap_or_else(|_| panic!("{name} must be committed"));
            let weights: EngineWeights = serde_json::from_str(&source)
                .unwrap_or_else(|error| panic!("{name} must load as weights: {error}"));
            weights
                .validate()
                .unwrap_or_else(|error| panic!("{name} must validate: {error}"));

            let mut perturbed = base.clone();
            for (key, value) in overrides {
                let range = &bounds["placement"][key];
                assert!(
                    *value >= range["min"].as_f64().expect("min")
                        && *value <= range["max"].as_f64().expect("max"),
                    "{name}: {key} at {value} must sit inside its committed sweep-bounds range"
                );
                assert_ne!(
                    base[key].as_f64(),
                    Some(*value),
                    "{name}: {key} at {value} is the shipped value, so the arm perturbs nothing"
                );
                perturbed[key] = Value::from(*value);
            }
            let file: Value = serde_json::from_str(&source).expect("valid JSON");
            assert_eq!(
                file, perturbed,
                "{name} must be the pre-adoption defaults with {overrides:?} and nothing else moved"
            );
            expected.push(name);
        }

        let mut found = Vec::new();
        for entry in std::fs::read_dir(&arms_dir).expect("arms dir") {
            let name = entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("sp6") {
                found.push(name);
            }
        }
        found.sort();
        expected.sort();
        assert_eq!(
            found, expected,
            "the SP6 phase commits one arm per preregistered value"
        );
    }

    /// The decay pair carries the same `expansionWeight` as `sp6_expansion`, which is what makes
    /// M-62's second invocation a reading of `expansionDecay` alone rather than of two axes at
    /// once. The reference of that invocation is an expansion arm and its arms are the decay
    /// pair, so a later edit that moved either weight would turn a decay contrast into a
    /// two-axis one without changing a single assertion above.
    #[test]
    fn the_sp6_decay_arms_share_the_reference_arms_expansion_weight() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let read = |stem: &str| -> Value {
            let source =
                std::fs::read_to_string(format!("{placement_dir}/arms/{stem}.json")).expect(stem);
            serde_json::from_str(&source).expect("valid JSON")
        };
        let reference = read("sp6_expansion");
        for stem in ["sp6_decay_lo", "sp6_decay_hi"] {
            let arm = read(stem);
            assert_eq!(
                arm["expansionWeight"], reference["expansionWeight"],
                "{stem} must carry sp6_expansion's expansionWeight so the decay contrast is decay alone"
            );
            assert_ne!(
                arm["expansionDecay"], reference["expansionDecay"],
                "{stem} must move the decay off the reference's, or it is the reference"
            );
        }
    }

    /// The axes M-62's re-screen left standing, at the values it read them at. One axis
    /// survived of the four SP6 carried in: `expansionWeight` at 0.1 read `better` at both
    /// powers, `expansionDecay` and `diversityWeight` were dropped null and
    /// `robberConcentrationWeight` dropped unresolved.
    const SP6_KEPT_AXES: [(&str, f64); 1] = [("expansionWeight", 0.1)];

    /// Pins the SP6 outcome (M-66, gate `better` at +1.097pp on `gate2`, adopted). Three
    /// files have to agree for the adoption to mean what the record says it means:
    /// `sp6-pre-adoption-weights.json` is the vector every SP-family arm perturbs and every
    /// M-61 through M-66 reading was taken against, `sp6-candidate-weights.json` is the
    /// vector the `eval2` confirmation and the `gate2` gate read, and the live
    /// `default-weights.json` is what ships. Adoption makes the candidate and the live
    /// defaults the same vector, and leaves the pre-adoption snapshot differing from both on
    /// exactly `SP6_KEPT_AXES`.
    ///
    /// The differing-leaf walk is what makes "nothing else moved" an assertion rather than a
    /// claim: a stray edit anywhere in the shipped vector fails here rather than silently
    /// shipping an axis no gate ever read.
    ///
    /// With one survivor the candidate is also the same vector as `arms/sp6_expansion.json`,
    /// the arm M-62 read against `base`, and no coordinate pass was run because a single axis
    /// cannot stack with anything. That equality is asserted so the adopted vector and the
    /// arm the record cites cannot drift apart.
    #[test]
    fn the_sp6_candidate_file_records_the_adopted_vector() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let read = |path: String| -> String {
            std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("{path} must be committed"))
        };
        let load = |name: &str, source: &str| -> Value {
            let weights: EngineWeights = serde_json::from_str(source)
                .unwrap_or_else(|error| panic!("{name} must load as weights: {error}"));
            weights
                .validate()
                .unwrap_or_else(|error| panic!("{name} must validate: {error}"));
            serde_json::from_str(source).expect("valid JSON")
        };

        let candidate = load(
            "sp6-candidate-weights.json",
            &read(format!("{placement_dir}/sp6-candidate-weights.json")),
        );
        let base = load(
            "sp6-pre-adoption-weights.json",
            &read(SP6_PRE_ADOPTION_WEIGHTS_PATH.to_string()),
        );
        let shipped = load(
            "default-weights.json",
            &read(DEFAULT_WEIGHTS_PATH.to_string()),
        );
        let bounds: Value =
            serde_json::from_str(&read(SWEEP_BOUNDS_PATH.to_string())).expect("valid JSON");

        let mut expected = base.clone();
        for (key, value) in SP6_KEPT_AXES {
            let range = &bounds["placement"][key];
            assert!(
                value >= range["min"].as_f64().expect("min")
                    && value <= range["max"].as_f64().expect("max"),
                "{key} at {value} must sit inside its committed sweep-bounds range"
            );
            assert_ne!(
                base[key].as_f64(),
                Some(value),
                "{key} at {value} is the pre-adoption value, so the candidate carries nothing"
            );
            expected[key] = Value::from(value);
        }
        assert_eq!(
            candidate, expected,
            "the SP6 candidate must be the pre-adoption defaults with the kept axes at their recorded values"
        );
        assert_eq!(
            shipped, candidate,
            "adoption ships the gate-confirmed candidate, so the live defaults must be that vector"
        );

        let mut leaves = Vec::new();
        collect_leaf_paths(&base, "", &mut leaves);
        let mut moved: Vec<String> = leaves
            .into_iter()
            .filter(|leaf| shipped.pointer(leaf) != base.pointer(leaf))
            .collect();
        let mut kept: Vec<String> = SP6_KEPT_AXES
            .iter()
            .map(|(key, _)| format!("/{key}"))
            .collect();
        moved.sort();
        kept.sort();
        assert_eq!(
            moved, kept,
            "the shipped defaults must differ from the pre-adoption snapshot on exactly the kept axes"
        );

        let arm: Value =
            serde_json::from_str(&read(format!("{placement_dir}/arms/sp6_expansion.json")))
                .expect("valid JSON");
        assert_eq!(
            candidate, arm,
            "with one survivor the candidate is the arm M-62 read, so the two must not drift apart"
        );
    }

    /// The pre-adoption placement vector, leaf by leaf. `the_sp6_candidate_file_records_the_adopted_vector`
    /// above pins the snapshot only *relatively*, as the shipped vector with the kept axes put
    /// back, so on its own an edit that moved the same leaf in both files would keep every
    /// assertion there green while quietly rewriting what every SP-family arm is a perturbation
    /// of. This is the absolute pin: the literal vector M-61 through M-66 were measured against,
    /// which is `DEFAULT_WEIGHTS` as it stood before the SP6 adoption.
    #[test]
    fn the_sp6_pre_adoption_snapshot_is_the_literal_measured_vector() {
        let source = std::fs::read_to_string(SP6_PRE_ADOPTION_WEIGHTS_PATH)
            .expect("sp6-pre-adoption-weights.json must be committed");
        let weights: EngineWeights = serde_json::from_str(&source)
            .unwrap_or_else(|error| panic!("the SP6 snapshot must load as weights: {error}"));
        weights.validate().expect("the SP6 snapshot must validate");
        let snapshot: Value = serde_json::from_str(&source).expect("valid JSON");

        let mut neutral_slot = serde_json::Map::new();
        neutral_slot.insert("expansion".into(), Value::from(1));
        neutral_slot.insert("diversity".into(), Value::from(1));
        let mut slot_scales = serde_json::Map::new();
        for seats in 3..=6 {
            let mut row = serde_json::Map::new();
            for slot in 0..seats {
                row.insert(slot.to_string(), Value::Object(neutral_slot.clone()));
            }
            slot_scales.insert(seats.to_string(), Value::Object(row));
        }

        let expected = serde_json::json!({
            "resourceValue": {
                "wheat": 1.35,
                "ore": 1.3,
                "wood": 0.8,
                "brick": 0.8,
                "sheep": 0.75
            },
            "handValueWeight": 0,
            "scarcityWeight": 0.35,
            "scarcityClampMin": 0.5,
            "scarcityClampMax": 2,
            "diversityWeight": 1.6,
            "diversityCap": 4,
            "coverageExponent": 1.5,
            "coverageScarcityWeight": 0.5,
            "duplicateNumberPenalty": 0.08,
            "recipeRoadBonus": 1.5,
            "recipeCityBonus": 2,
            "recipeSettlementBonus": 1,
            "recipeDevCardBonus": 0,
            "recipeCap": 4,
            "portWeight": 0.55,
            "genericPortFactor": 0.5,
            "portSurplusThreshold": 3,
            "portCoverageDeficitWeight": 0,
            "nearPortRadius": 2,
            "nearPortDecay": 0.5,
            "expansionWeight": 0,
            "expansionDecay": 0.5,
            "robberDiscount": 0.35,
            "robberConcentrationWeight": 0,
            "setupDenialWeight": 0,
            "opponentTopK": 3,
            "softmaxTemperature": 1.25,
            "rolloutBudget": 500000,
            "rolloutsMin": 4,
            "rolloutsMax": 24,
            "maxResults": 8,
            "slotScales": Value::Object(slot_scales)
        });
        assert_eq!(
            snapshot, expected,
            "the SP6 pre-adoption snapshot is a frozen measurement record and must not be edited"
        );
    }

    /// Walks every committed weights-shaped file (the shipped vector, the three committed
    /// candidate and snapshot records, and the weights arms under `placement/arms/`) through the full
    /// `EngineWeights` contract:
    /// the exact-key rule (`deny_unknown_fields` plus serde's missing-field error) and
    /// `validate`. `contracts.md` states such a walk exists and none did, so until now a
    /// weights arm left behind by a new formula weight failed silently, at run time, in
    /// whichever measurement first selected it. A weights file is one carrying
    /// `resourceValue`; the count pins the set so a file that loses the key is a failure
    /// rather than a skip.
    #[test]
    fn every_committed_weights_file_loads_through_the_full_contract() {
        let placement_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../placement");
        let load = |name: &str, source: &str| {
            let weights: EngineWeights = serde_json::from_str(source)
                .unwrap_or_else(|error| panic!("{name} must load as weights: {error}"));
            weights
                .validate()
                .unwrap_or_else(|error| panic!("{name} must validate: {error}"));
        };
        for name in [
            "default-weights.json",
            "phase-i-candidate-weights.json",
            "sp6-candidate-weights.json",
            "sp6-pre-adoption-weights.json",
        ] {
            let source = std::fs::read_to_string(format!("{placement_dir}/{name}"))
                .expect("committed weights vector");
            load(name, &source);
        }

        let mut weights_arms = 0;
        for entry in std::fs::read_dir(format!("{placement_dir}/arms")).expect("arms dir") {
            let path = entry.expect("entry").path();
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();
            if !name.ends_with(".json") {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("arm file");
            let file: Value = serde_json::from_str(&source).expect("valid JSON");
            if file.get("resourceValue").is_none() {
                continue;
            }
            weights_arms += 1;
            load(&name, &source);
        }
        assert_eq!(
            weights_arms, 64,
            "the committed weights arms are 64 files; a change to the set is a decision"
        );
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
