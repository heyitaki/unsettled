#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0_u8; len].into_boxed_slice()) as *mut u8
}

/// # Safety
/// `ptr` must be an allocation returned by this module, with its original length.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len))) }
}

#[cfg(target_arch = "wasm32")]
unsafe extern "C" {
    /// The host's progress bar: the fraction of the running `analyze` call done so far.
    safe fn progress(fraction: f64);
}

/// A native build has no host to report to.
#[cfg(not(target_arch = "wasm32"))]
fn progress(_fraction: f64) {}

/// Reads a UTF-8 request and returns the response behind its 4-byte little-endian length.
///
/// # Safety
/// `ptr` must point to `len` readable bytes for the duration of this call.
unsafe fn respond(ptr: *const u8, len: usize, run: impl FnOnce(&str) -> String) -> *mut u8 {
    let input = if len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len) }
    };
    let response = match std::str::from_utf8(input) {
        Ok(request) => run(request),
        Err(_) => r#"{"error":"request is not valid UTF-8"}"#.into(),
    };
    let mut output = Vec::with_capacity(4 + response.len());
    output.extend_from_slice(&(response.len() as u32).to_le_bytes());
    output.extend_from_slice(response.as_bytes());
    Box::into_raw(output.into_boxed_slice()) as *mut u8
}

/// # Safety
/// `ptr` must point to `len` readable bytes for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn advise(ptr: *const u8, len: usize) -> *mut u8 {
    unsafe { respond(ptr, len, unsettled_engine::advice::advise) }
}

/// # Safety
/// `ptr` must point to `len` readable bytes for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn analyze(ptr: *const u8, len: usize) -> *mut u8 {
    unsafe {
        respond(ptr, len, |request| {
            unsettled_engine::placement::analysis::analyze(request, &mut |fraction| progress(fraction))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_through_the_exports() {
        use unsettled_engine::topology::{Layout, Topology};

        let topology = Topology::load(Layout::Standard4).unwrap();
        let hexes: Vec<_> = (0..topology.hex_count() as u8)
            .map(|hex| {
                let (q, r) = topology.hex_key(hex).split_once(',').unwrap();
                format!(r#"{{"coord":{{"q":{q},"r":{r}}},"tile":"wood","numberToken":6}}"#)
            })
            .collect();
        let request = format!(
            r#"{{"game":{{"schemaVersion":1,"board":{{"schemaVersion":1,
            "layout":"standard4","hexes":[{}],"ports":[],"roads":[],"buildings":[],
            "players":[{{"id":"p1","name":"Red","color":"red"}},
                {{"id":"p2","name":"Blue","color":"blue"}}],"mePlayerId":"p1",
            "robber":{{"q":0,"r":0}}}},"stats":{{}}}},"decision":{{"kind":"turn"}}}}"#,
            hexes.join(",")
        );
        let expected = unsettled_engine::advice::advise(&request);
        assert!(expected.contains(r#""type":"pass""#), "{expected}");
        for input in [request.as_bytes(), &[0xff, 0xfe], &[]] {
            unsafe {
                let request_ptr = alloc(input.len());
                std::ptr::copy_nonoverlapping(input.as_ptr(), request_ptr, input.len());
                let response_ptr = advise(request_ptr, input.len());
                let length = u32::from_le_bytes(
                    std::slice::from_raw_parts(response_ptr, 4)
                        .try_into()
                        .unwrap(),
                ) as usize;
                let response =
                    std::str::from_utf8(std::slice::from_raw_parts(response_ptr.add(4), length))
                        .unwrap();
                let expected = match std::str::from_utf8(input) {
                    Ok(request) => unsettled_engine::advice::advise(request),
                    Err(_) => r#"{"error":"request is not valid UTF-8"}"#.into(),
                };
                assert_eq!(response, expected);
                assert_eq!(std::slice::from_raw_parts(request_ptr, input.len()), input);
                dealloc(response_ptr, length + 4);
                dealloc(request_ptr, input.len());
            }
        }
    }
}
