#!/usr/bin/env node

import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
rmSync("node_modules/.cache/tsconfig.build.tsbuildinfo", { force: true });
