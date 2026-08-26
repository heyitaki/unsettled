use std::fs;
use std::path::PathBuf;
use std::process::Command;

use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
use unsettled_engine::policy::denial::DenialParams;
use unsettled_engine::policy::devcards::DevCardParams;
use unsettled_engine::policy::heuristic_v1::HeuristicParams;
use unsettled_engine::policy::threat::ThreatParams;
use unsettled_engine::policy::trading::TradeParams;
use unsettled_engine::topology::Layout;
use unsettled_sim::evaluate::{EvaluateRequest, EvaluationDomain, evaluate};

fn temporary_output(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("unsettled-sim-{name}-{}", std::process::id()))
}

fn evaluate_cli_args(out: &std::path::Path) -> Vec<String> {
    vec![
        "evaluate".into(),
        "--layout".into(),
        "standard4".into(),
        "--seats".into(),
        "4".into(),
        "--domain".into(),
        "tuning".into(),
        "--field".into(),
        "pip_diversity".into(),
        "--arm".into(),
        "base=pip_diversity".into(),
        "--arm".into(),
        "candidate=pip_diversity".into(),
        "--reference".into(),
        "base".into(),
        "--boards".into(),
        "8".into(),
        "--reps".into(),
        "4".into(),
        "--policy".into(),
        "heuristic-v1".into(),
        "--threads".into(),
        "1".into(),
        "--out".into(),
        out.display().to_string(),
    ]
}

#[test]
fn arm_policy_override_separates_two_otherwise_identical_arms() {
    let out = temporary_output("arm-policy-separation");
    if out.exists() {
        fs::remove_dir_all(&out).unwrap();
    }
    let mut args = evaluate_cli_args(&out);
    args.extend([
        "--arm-policy".into(),
        "base=heuristic-v1".into(),
        "--arm-policy".into(),
        "candidate=heuristic-v1-threat".into(),
    ]);
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let evaluation: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.join("evaluation.json")).unwrap()).unwrap();
    let pair = &evaluation["pairs"][0];
    let discordant = pair["b"].as_u64().unwrap() + pair["c"].as_u64().unwrap();
    assert!(discordant > 0);
    fs::remove_dir_all(out).unwrap();
}

#[test]
fn arm_policy_rejects_an_unknown_label_and_an_unknown_policy() {
    let out = temporary_output("arm-policy-errors");
    for (spec, expected) in [
        (
            "missing=heuristic-v1",
            "error: arm policy missing does not name an arm\n",
        ),
        ("base=not-a-policy", "error: unknown policy not-a-policy\n"),
    ] {
        let mut args = evaluate_cli_args(&out);
        args.extend(["--arm-policy".into(), spec.into()]);
        let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
            .args(args)
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert_eq!(String::from_utf8(output.stderr).unwrap(), expected);
    }
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

fn write_params_file(name: &str, params: &HeuristicParams) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "unsettled-sim-params-{name}-{}.json",
        std::process::id()
    ));
    fs::write(&path, serde_json::to_string(params).unwrap()).unwrap();
    path
}

const COMPOSITE: &str = "heuristic-v1-trader-aware-threat-devcards-denial";

fn discordant_games(out: &std::path::Path, params_path: &std::path::Path) -> u64 {
    let mut args = evaluate_cli_args(out);
    args.extend([
        "--player-trading".into(),
        "--arm-policy".into(),
        format!("base={COMPOSITE}"),
        "--arm-policy".into(),
        format!("candidate={COMPOSITE}@{}", params_path.display()),
    ]);
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let evaluation: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.join("evaluation.json")).unwrap()).unwrap();
    let pair = &evaluation["pairs"][0];
    pair["b"].as_u64().unwrap() + pair["c"].as_u64().unwrap()
}

/// A params file spelling out the composite's exact defaults must be bit-identical to the
/// named composite: the evaluation seed never mixes the policy, so any discordant game
/// would mean the file's numbers did not reach dispatch the way the kind's own params do.
#[test]
fn a_composite_defaults_params_file_matches_its_base_bit_for_bit() {
    let out = temporary_output("arm-policy-params-identity");
    if out.exists() {
        fs::remove_dir_all(&out).unwrap();
    }
    let params_path = write_params_file("identity", &composite_defaults());
    assert_eq!(discordant_games(&out, &params_path), 0);
    fs::remove_file(params_path).unwrap();
    fs::remove_dir_all(out).unwrap();
}

/// The non-trader dispatch family, end to end: a plain-base params file spelling out
/// `heuristic-v1`'s defaults must be bit-identical to the named kind in a field of
/// traders with player trading enabled. Any discordant game would mean the custom
/// policy's stored family flag did not reach `policy::action`/`policy::respond_trade` —
/// a hero that wrongly took the trader path would offer or accept trades the named
/// non-trader never makes.
#[test]
fn a_plain_base_defaults_params_file_matches_heuristic_v1_bit_for_bit() {
    let out = temporary_output("arm-policy-plain-family-identity");
    if out.exists() {
        fs::remove_dir_all(&out).unwrap();
    }
    let params_path = write_params_file("plain-family", &HeuristicParams::default());
    let mut args = evaluate_cli_args(&out);
    let field_policy = args.iter().position(|arg| arg == "--policy").unwrap() + 1;
    args[field_policy] = "heuristic-v1-trader".into();
    args.extend([
        "--player-trading".into(),
        "--arm-policy".into(),
        "base=heuristic-v1".into(),
        "--arm-policy".into(),
        format!("candidate=heuristic-v1@{}", params_path.display()),
    ]);
    let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let evaluation: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.join("evaluation.json")).unwrap()).unwrap();
    let pair = &evaluation["pairs"][0];
    assert_eq!(pair["b"].as_u64().unwrap() + pair["c"].as_u64().unwrap(), 0);
    fs::remove_file(params_path).unwrap();
    fs::remove_dir_all(out).unwrap();
}

/// The converse observer: a params file that zeroes the production term must change
/// decisions, proving the file's values (not the base kind's) are what play.
#[test]
fn a_params_file_with_different_params_separates_from_its_base() {
    let out = temporary_output("arm-policy-params-separation");
    if out.exists() {
        fs::remove_dir_all(&out).unwrap();
    }
    let params_path = write_params_file(
        "separation",
        &HeuristicParams {
            production_weight: 0.0,
            ..composite_defaults()
        },
    );
    assert!(discordant_games(&out, &params_path) > 0);
    fs::remove_file(params_path).unwrap();
    fs::remove_dir_all(out).unwrap();
}

#[test]
fn a_params_file_load_failure_is_a_cli_error() {
    let out = temporary_output("arm-policy-params-errors");
    let headroom_path = write_params_file(
        "headroom",
        &HeuristicParams {
            production_weight: 1000.0,
            ..composite_defaults()
        },
    );
    for (spec, expected) in [
        (
            format!("candidate={COMPOSITE}@/nonexistent/params.json"),
            "failed to read policy params",
        ),
        (
            format!("candidate={COMPOSITE}@{}", headroom_path.display()),
            "headroom",
        ),
    ] {
        let mut args = evaluate_cli_args(&out);
        args.extend(["--arm-policy".into(), spec]);
        let output = Command::new(env!("CARGO_BIN_EXE_unsettled-sim"))
            .args(args)
            .output()
            .unwrap();
        assert!(!output.status.success());
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(stderr.contains(expected), "{stderr}");
    }
    fs::remove_file(headroom_path).unwrap();
}

fn evaluation_with_override(
    policy: Option<PolicyKind>,
    policy_name: Option<&str>,
) -> unsettled_sim::evaluate::Evaluation {
    let arms = vec![("only".to_string(), PlacementKind::PipDiversity)];
    let arm_specs = vec!["pip_diversity".to_string()];
    let arm_policies = vec![policy];
    let arm_policy_names = vec![policy_name.map(str::to_string)];
    evaluate(EvaluateRequest {
        layout: Layout::Standard4,
        seats: 4,
        domain: EvaluationDomain::Tuning,
        field_spec: "pip_diversity",
        field: PlacementKind::PipDiversity,
        arms: &arms,
        arm_specs: &arm_specs,
        arm_policies: &arm_policies,
        arm_policy_names: &arm_policy_names,
        reference: None,
        boards: 1,
        reps: 1,
        policy: PolicyKind::HeuristicV1,
        policy_name: "heuristic-v1",
        player_trading: None,
        threshold: 0.01,
        alpha: 0.05,
        threads: 1,
        allow_unofficial: false,
    })
    .unwrap()
}

#[test]
fn evaluation_config_omits_arm_policies_when_no_override_is_given() {
    let without = serde_json::to_string(&evaluation_with_override(None, None)).unwrap();
    assert!(!without.contains("armPolicies"));
    let with = serde_json::to_string(&evaluation_with_override(
        Some(PolicyKind::HeuristicV1Threat),
        Some("heuristic-v1-threat"),
    ))
    .unwrap();
    assert!(with.contains("\"armPolicies\":{\"only\":\"heuristic-v1-threat\"}"));
}
