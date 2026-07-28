// electrobun ships TypeScript *sources* (not just declarations) and one of them
// imports `three`, which has no bundled types. `skipLibCheck` only covers .d.ts
// files, so without this shim typechecking apps/desktop fails inside a
// dependency we do not control. We never touch `three` ourselves.
declare module "three"
