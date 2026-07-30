import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { ThemeLabPanel } from "../features/theme-lab/ThemeLabPanel"
import { THEME_FAMILIES } from "../lib/ui/theme.core"

// /theme-lab — every theme the repo ships, on one page.
//
// Reviewing a family used to be five views times two variants, eyeballed one
// theme at a time through the Appearance picker. This is the same review as a
// single scroll: each panel scopes itself with `data-theme`, so every family and
// both variants paint at once with no picker and no reload.
//
// **Reachability, on purpose.** This is a real file-based route, so it is imported
// by `routeTree.gen.ts`, which `main.tsx` imports — `fallow audit`'s dead-code
// check walks that chain from an entry point and finds it. A dev-only `import.meta.env.DEV`
// guard would have left the module imported and the component body unreachable,
// which is the shape that trips the audit; and a query param on `/` would have
// put lab markup inside the dashboard route's tree, so the dashboard's own tests
// would have to know about it. A separate route costs the dashboard nothing and
// stays reachable by URL in dev and in the shipped SPA alike.
//
// It also passes the same two ratchets every other route does — no raw-palette
// colour utilities (`semanticPalette.test.ts`), no raw `rounded-*`
// (`semanticRadius.test.ts`) — which a page whose whole job is to render the
// palette had better do first.

export const Route = createFileRoute("/theme-lab")({
  component: ThemeLab,
})

const ALL = "all"

function ThemeLab() {
  const [only, setOnly] = useState<string>(ALL)
  const shown = only === ALL ? THEME_FAMILIES : THEME_FAMILIES.filter((f) => f.id === only)

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-2">
        <h1 className="font-semibold text-lg">Theme lab</h1>
        <p className="max-w-3xl text-sm text-base-content/70">
          Every semantic token, every daisyUI component this app uses, the three radius roles, and
          the session-state chips in <strong>both</strong> their idle and their reporting columns.
          That last pair is the review that matters: five of the seven ink tokens only paint when a
          session has something to report, so a family can clear every contrast gate and still show
          a single hue on an idle dashboard. Read the two chip columns together, or you are
          reviewing half the palette.
        </p>
      </header>

      <div role="tablist" className="flex flex-wrap gap-1">
        {[{ id: ALL, label: "All families" }, ...THEME_FAMILIES].map((family) => (
          <button
            key={family.id}
            role="tab"
            aria-selected={only === family.id}
            data-testid={`theme-lab-filter-${family.id}`}
            className={`btn btn-xs ${only === family.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setOnly(family.id)}
          >
            {family.id === ALL ? family.label : family.id}
          </button>
        ))}
      </div>

      {shown.map((family) => (
        <section key={family.id} className="space-y-2">
          <h2 className="font-semibold text-sm text-base-content/80">{family.label}</h2>
          {/* Light and dark side by side: a family is one design in two lightings,
              and every dark variant is the one where a saturated hue is least
              compromised. Comparing them one after the other hides that. */}
          <div className="grid gap-3 lg:grid-cols-2">
            <ThemeLabPanel theme={family.light} family={family.id} />
            <ThemeLabPanel theme={family.dark} family={family.id} />
          </div>
        </section>
      ))}
    </div>
  )
}
