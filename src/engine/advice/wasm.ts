export async function createAdviser(bytes: BufferSource): Promise<(request: string) => string> {
  const { instance } = await WebAssembly.instantiate(bytes)
  const { memory, alloc, dealloc, advise } = instance.exports as {
    memory: WebAssembly.Memory
    alloc(length: number): number
    dealloc(pointer: number, length: number): void
    advise(pointer: number, length: number): number
  }
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  return (request) => {
    const input = encoder.encode(request)
    const pointer = alloc(input.length)
    let response: number | undefined
    let length = 0
    try {
      new Uint8Array(memory.buffer, pointer, input.length).set(input)
      response = advise(pointer, input.length)
      length = new DataView(memory.buffer).getUint32(response, true)
      return decoder.decode(new Uint8Array(memory.buffer, response + 4, length))
    } finally {
      if (response !== undefined) dealloc(response, length + 4)
      dealloc(pointer, input.length)
    }
  }
}
