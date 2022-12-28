---
template: post
title: 'JavaScript heap out of memory'
slug: javascript-heap-out-of-memory
date: '2020-10-03'
category: serverless
draft: false
tags: ['sls', 'deploy', 'nodejs', 'javascript', 'webpack']
---

If you are getting below "Javascript heap out of memory" error when deploying your serverless project, try to run below command first before running "sls deploy":

```bash
export NODE_OPTIONS=--max_old_space_size=8192
```

When my serverless project grows, I am getting this error more often. And this trick works for me every single time.

A little googling reveals that it is an serverless-webpack issue and there is an open issue:
[JavaScript heap out of memory when packaging many functions #299](https://github.com/serverless-heaven/serverless-webpack/issues/299). But until it gets fixed, I will stick with this workaround first.

### "sls deploy" error messages:

```bash
Serverless: Bundling with Webpack...

<--- Last few GCs --->

[52898:0x110008000]    53295 ms: Scavenge 2037.2 (2047.5) -> 2036.5 (2047.7) MB, 6.2 / 0.0 ms  (average mu = 0.290, current mu = 0.354) allocation failure
[52898:0x110008000]    53365 ms: Scavenge 2037.3 (2047.7) -> 2036.6 (2047.7) MB, 6.6 / 0.0 ms  (average mu = 0.290, current mu = 0.354) allocation failure
[52898:0x110008000]    53431 ms: Scavenge 2037.5 (2047.7) -> 2036.8 (2048.5) MB, 6.4 / 0.0 ms  (average mu = 0.290, current mu = 0.354) allocation failure


<--- JS stacktrace --->

==== JS stack trace =========================================

    0: ExitFrame [pc: 0x1009ce0f9]
Security context: 0x19b75e5408d1 <JSObject>

FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
 1: 0x1011bdf85 node::Abort() (.cold.1) [/usr/local/bin/node]
 2: 0x10009d119 node::Abort() [/usr/local/bin/node]
 3: 0x10009d27f node::OnFatalError(char const*, char const*) [/usr/local/bin/node]
 4: 0x1001de7b7 v8::Utils::ReportOOMFailure(v8::internal::Isolate*, char const*, bool) [/usr/local/bin/node]
 5: 0x1001de757 v8::internal::V8::FatalProcessOutOfMemory(v8::internal::Isolate*, char const*, bool) [/usr/local/bin/node]
 6: 0x100364225 v8::internal::Heap::FatalProcessOutOfMemory(char const*) [/usr/local/bin/node]
 7: 0x100365a7a v8::internal::Heap::RecomputeLimits(v8::internal::GarbageCollector) [/usr/local/bin/node]
 8: 0x1003624fe v8::internal::Heap::PerformGarbageCollection(v8::internal::GarbageCollector, v8::GCCallbackFlags) [/usr/local/bin/node]
 9: 0x1003602b0 v8::internal::Heap::CollectGarbage(v8::internal::AllocationSpace, v8::internal::GarbageCollectionReason, v8::GCCallbackFlags) [/usr/local/bin/node]
10: 0x10035f301 v8::internal::Heap::HandleGCRequest() [/usr/local/bin/node]
11: 0x100324cd1 v8::internal::StackGuard::HandleInterrupts() [/usr/local/bin/node]
12: 0x1006887dc v8::internal::Runtime_StackGuard(int, unsigned long*, v8::internal::Isolate*) [/usr/local/bin/node]
13: 0x1009ce0f9 Builtins_CEntry_Return1_DontSaveFPRegs_ArgvOnStack_NoBuiltinExit [/usr/local/bin/node]
zsh: abort      sls deploy
```
