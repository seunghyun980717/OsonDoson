from poc.seq2seq.data_builder import (
    RawRecord,
    assign_components,
    build_audit_report,
    deduplicate_records,
    normalize_gloss_string,
    normalize_korean,
    project_gloss_to_runtime,
    split_components,
)


def test_normalization_collapses_spacing_and_delimiters():
    assert normalize_korean("  안녕하세요   여러분 ") == "안녕하세요 여러분"
    assert normalize_gloss_string("가다/ 어디 , 무엇") == "가다 어디 무엇"


def test_deduplicate_keeps_full_gloss_by_default():
    raw_records = [
        RawRecord("r1", "malmoongchi", "계좌를 만들고 싶어요", "은행 계좌 만들다 원하다", {}),
    ]
    deduped = deduplicate_records(raw_records, filter_to_word_db=False, word_db_vocab={"은행", "원하다"})
    assert deduped[0]["gloss"] == "은행 계좌 만들다 원하다"
    assert deduped[0]["runtime_gloss"] == "은행 원하다"


def test_project_gloss_to_runtime_filters_only_runtime_tokens():
    projected = project_gloss_to_runtime(["은행", "계좌", "만들다", "원하다"], {"은행", "원하다"})
    assert projected == ["은행", "원하다"]


def test_component_split_prevents_overlap():
    raw_records = [
        RawRecord("r1", "gksl_original", "안녕하세요", "인사", {}),
        RawRecord("r2", "malmoongchi", "안녕하세요", "인사", {}),
        RawRecord("r3", "gksl_original", "어디 가요", "어디 가다", {}),
        RawRecord("r4", "malmoongchi", "어디 가요", "어디 가다", {}),
        RawRecord("r5", "malmoongchi", "무엇 합니까", "무엇 하다", {}),
    ]

    deduped = deduplicate_records(raw_records, filter_to_word_db=False, word_db_vocab=set())
    components = assign_components(deduped)
    split_records = split_components(components, train_ratio=0.6, val_ratio=0.2, test_ratio=0.2, seed=7)
    audit = build_audit_report(split_records)

    assert audit["clean"] is True
    assert all(value == 0 for group in audit["leakage"].values() for value in group.values())
