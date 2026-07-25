pub const MAX_SEATS: usize = 6;

#[derive(Clone, Debug)]
pub struct Xoshiro256StarStar {
    state: [u64; 4],
}

impl Xoshiro256StarStar {
    pub fn from_seed(seed: u64) -> Self {
        let mut state_seed = seed;
        let state = [
            splitmix64(&mut state_seed),
            splitmix64(&mut state_seed),
            splitmix64(&mut state_seed),
            splitmix64(&mut state_seed),
        ];
        Self { state }
    }

    pub fn next_u64(&mut self) -> u64 {
        let result = self.state[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let shift = self.state[1] << 17;
        self.state[2] ^= self.state[0];
        self.state[3] ^= self.state[1];
        self.state[1] ^= self.state[2];
        self.state[0] ^= self.state[3];
        self.state[2] ^= shift;
        self.state[3] = self.state[3].rotate_left(45);
        result
    }

    pub fn range(&mut self, upper: u32) -> u32 {
        assert!(upper > 0);
        let zone = u64::MAX - u64::MAX % u64::from(upper);
        loop {
            let value = self.next_u64();
            if value < zone {
                return (value % u64::from(upper)) as u32;
            }
        }
    }

    pub fn shuffle<T>(&mut self, values: &mut [T]) {
        for index in (1..values.len()).rev() {
            let swap = self.range((index + 1) as u32) as usize;
            values.swap(index, swap);
        }
    }
}

#[derive(Clone, Debug)]
pub struct Streams {
    pub dice: Xoshiro256StarStar,
    pub deck: Xoshiro256StarStar,
    pub chance: Xoshiro256StarStar,
    pub policy: [Xoshiro256StarStar; MAX_SEATS],
}

impl Streams {
    pub fn new(game_seed: u64) -> Self {
        let derive = |tag| Xoshiro256StarStar::from_seed(mix64(game_seed ^ tag));
        Self {
            dice: derive(0xd1ce_d1ce_d1ce_d1ce),
            deck: derive(0xdec0_dec0_dec0_dec0),
            chance: derive(0xc4a9_ce00_c4a9_ce00),
            policy: std::array::from_fn(|seat| derive(0x9011_c100_0000_0000 ^ seat as u64)),
        }
    }
}

pub fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    mix64(*state)
}

pub fn mix64(mut value: u64) -> u64 {
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

pub fn derive_game_seed(base_seed: u64, board_index: u64, rep_index: u64) -> u64 {
    let coordinate =
        mix64(board_index ^ 0x626f_6172_6400_0000) ^ mix64(rep_index ^ 0x7265_7000_0000_0000);
    mix64(base_seed ^ coordinate)
}

pub fn derive_evaluation_seed(
    base_seed: u64,
    board_index: u64,
    rep_index: u64,
    rotation: u64,
) -> u64 {
    mix64(derive_game_seed(base_seed, board_index, rep_index) ^ mix64(rotation))
}

#[cfg(test)]
mod tests {
    use super::Xoshiro256StarStar;

    #[test]
    fn xoshiro256_star_star_matches_the_published_reference_vector() {
        let mut rng = Xoshiro256StarStar {
            state: [1, 2, 3, 4],
        };
        assert_eq!(
            (0..10).map(|_| rng.next_u64()).collect::<Vec<_>>(),
            vec![
                11_520,
                0,
                1_509_978_240,
                1_215_971_899_390_074_240,
                1_216_172_134_540_287_360,
                607_988_272_756_665_600,
                16_172_922_978_634_559_625,
                8_476_171_486_693_032_832,
                10_595_114_339_597_558_777,
                2_904_607_092_377_533_576,
            ]
        );
    }
}
