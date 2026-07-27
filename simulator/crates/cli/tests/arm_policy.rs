use std::fs;
use std::path::PathBuf;
use std::process::Command;

use unsettled_engine::placement::PlacementKind;
use unsettled_engine::policy::PolicyKind;
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
