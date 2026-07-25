use unsettled_engine::placement::app_formula::EngineWeights;
use unsettled_engine::placement::register_app_formula;

#[test]
fn the_app_formula_registry_cap_is_a_named_error() {
    let weights: EngineWeights =
        serde_json::from_str(include_str!("../../../placement/default-weights.json")).unwrap();
    for index in 0..256 {
        register_app_formula(format!("cap-{index}"), weights.clone()).unwrap();
    }

    let error = register_app_formula("overflow".into(), weights).unwrap_err();
    assert_eq!(error, "at most 256 app formula arms may be registered");
}
