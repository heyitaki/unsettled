use unsettled_engine::rng::Streams;

fn traces(mut streams: Streams) -> ([u64; 8], [u64; 8], [u64; 8], [[u64; 8]; 6]) {
    (
        std::array::from_fn(|_| streams.dice.next_u64()),
        std::array::from_fn(|_| streams.deck.next_u64()),
        std::array::from_fn(|_| streams.chance.next_u64()),
        std::array::from_fn(|seat| std::array::from_fn(|_| streams.policy[seat].next_u64())),
    )
}

#[test]
fn trade_stream_advancement_is_isolated_from_every_existing_stream() {
    let expected = traces(Streams::new(42));
    let mut advanced = Streams::new(42);
    for _ in 0..10_000 {
        advanced.trade.next_u64();
    }

    assert_eq!(traces(advanced), expected);
}

#[test]
fn existing_stream_advancement_is_isolated_from_the_trade_stream() {
    let mut expected = Streams::new(42);
    let trade = std::array::from_fn::<_, 100, _>(|_| expected.trade.next_u64());
    let mut advanced = Streams::new(42);
    for _ in 0..10_000 {
        advanced.dice.next_u64();
        advanced.deck.next_u64();
        advanced.chance.next_u64();
        for policy in &mut advanced.policy {
            policy.next_u64();
        }
    }

    assert_eq!(
        std::array::from_fn::<_, 100, _>(|_| advanced.trade.next_u64()),
        trade
    );
}
