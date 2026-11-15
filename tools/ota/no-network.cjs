// Preloaded (NODE_OPTIONS=--require) into the Capgo CLI by tools/ota/publish.mjs:
// zip and encrypt work offline, so any network attempt is a bug and must fail.
'use strict'
const net = require('node:net')
const dns = require('node:dns')

const refuse = (what) => {
  throw new Error(`no-network: blocked ${what}`)
}

net.Socket.prototype.connect = function () {
  refuse('socket connect')
}
for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveSrv', 'resolveTxt', 'reverse']) {
  dns[name] = () => refuse(`dns.${name}`)
  dns.promises[name] = () => refuse(`dns.promises.${name}`)
}
dns.Resolver = dns.promises.Resolver = class {
  constructor() {
    refuse('dns.Resolver')
  }
}

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!String(url).startsWith('data:')) refuse(`fetch ${url}`)
  return realFetch(input, init)
}
