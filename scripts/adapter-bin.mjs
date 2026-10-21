#!/usr/bin/env node
// adapter-bin.mjs <adapter> — prints the adapter's executable name (exit 1 when unknown).
import { adapters } from '../server/adapters.mjs'

const a = adapters[process.argv[2]]
if (!a) process.exit(1)
console.log(a.bin)
