import type { SessionStateSlug } from "@pid/shared"
import { stateColor } from "../../lib/format"
import {
  IDLE_STATES,
  INK_SWATCHES,
  RADIUS_ROLES,
  REPORTING_STATES,
  SURFACE_SWATCHES,
} from "./themeLab"

// One theme's whole surface, on one card.
//
// The panel scopes itself with `data-theme`, which is what makes the lab a single
// page rather than thirty screenshots: daisyUI emits each theme as a
// `[data-theme=…]` rule, so nesting a div per theme paints every family and both
// variants at once, side by side, with no picker and no reload.
//
// The state chips are the point of the page. Two columns — idle and reporting —
// because five of the seven ink tokens only paint when a session has something to
// report, and `prism`'s first version passed every gate with an idle dashboard
// that showed one hue. Reviewing the left column alone is exactly the mistake.

const Heading = ({ children }: { readonly children: string }) => (
  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-base-content/50">
    {children}
  </h3>
)

const StateChips = ({
  states,
  title,
}: {
  readonly states: readonly SessionStateSlug[]
  readonly title: string
}) => (
  <div className="flex-1 space-y-1.5">
    <Heading>{title}</Heading>
    <div className="flex flex-wrap gap-1.5">
      {states.map((state) => {
        const tone = stateColor(state)
        return (
          <span
            key={state}
            className={`inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-[11px] font-semibold ${tone.bg} ${tone.text}`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            {tone.label}
          </span>
        )
      })}
    </div>
  </div>
)

export const ThemeLabPanel = ({
  theme,
  family,
}: {
  readonly theme: string
  readonly family: string
}) => (
  <section
    data-theme={theme}
    data-testid={`theme-lab-panel-${theme}`}
    className="space-y-4 rounded-box border-2 border-base-300 bg-gradient-to-b from-base-100 to-base-200 p-4 text-base-content"
  >
    <header className="flex items-baseline justify-between gap-2">
      <h2 className="font-semibold text-sm">{theme}</h2>
      <span className="text-[11px] text-base-content/60">{family}</span>
    </header>

    {/* Surfaces. base-100 is ~75% of the painted pixels, so a family that spends
        its colour budget on accents is optimising ~2% of the screen. */}
    <div className="space-y-1.5">
      <Heading>surfaces</Heading>
      <div className="grid grid-cols-4 gap-1.5">
        {SURFACE_SWATCHES.map(({ token, surface, note }) => (
          <div key={token} title={note} className="space-y-1">
            <div className={`h-8 rounded-btn border border-base-300 ${surface}`} />
            <div className="truncate text-[10px] text-base-content/60">{token}</div>
          </div>
        ))}
      </div>
    </div>

    {/* …and the same tokens as ink, the direction the 4.5:1 floor measures. */}
    <div className="space-y-1.5">
      <Heading>ink on base-100</Heading>
      <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-btn bg-base-100 p-2">
        {INK_SWATCHES.map(({ token, ink }) => (
          <span key={token} className={`text-xs font-semibold ${ink}`}>
            {token}
          </span>
        ))}
      </div>
      <p className="rounded-btn bg-primary p-2 text-xs text-primary-content">
        primary-content on primary — the only content token every theme declares
      </p>
    </div>

    <div className="flex flex-wrap gap-3">
      <StateChips states={IDLE_STATES} title="idle — what a quiet page shows" />
      <StateChips states={REPORTING_STATES} title="reporting — only when a session says so" />
    </div>

    {/* Shape, at each of the three roles. */}
    <div className="space-y-1.5">
      <Heading>radius roles</Heading>
      <div className="flex gap-2">
        {RADIUS_ROLES.map(({ role, cls, reads }) => (
          <div key={role} title={reads} className="flex-1 space-y-1">
            <div className={`h-8 border-2 border-primary bg-base-300 ${cls}`} />
            <div className="truncate text-[10px] text-base-content/60">{role}</div>
          </div>
        ))}
      </div>
    </div>

    {/* Every daisyUI component the app actually uses. Not a catalogue of the
        library — the point is what a family does to *this* app. */}
    <div className="space-y-2">
      <Heading>components</Heading>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm">btn-primary</button>
        <button className="btn btn-sm">btn</button>
        <button className="btn btn-outline btn-sm">outline</button>
        <span className="badge badge-primary">badge</span>
        <span className="badge">badge</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="input input-bordered input-sm w-28" placeholder="input" readOnly />
        <select className="select select-bordered select-sm w-28" defaultValue="select">
          <option>select</option>
        </select>
      </div>
      {/* `tabs-boxed`, matching the spawn modal's harness picker — the app's only
          daisyUI tab strip. Reviewing `tabs-bordered` here would review a variant
          nothing renders. */}
      <div role="tablist" className="tabs tabs-boxed tabs-sm w-fit">
        <button role="tab" className="tab tab-active">
          active
        </button>
        <button role="tab" className="tab">
          tab
        </button>
      </div>
      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-1 p-3">
          <span className="text-xs font-semibold">card</span>
          <span className="text-[11px] text-base-content/60">card-body on base-100</span>
        </div>
      </div>
      {/* The `static` is load-bearing, and this lab is how it was found. daisyUI's
          `.modal` is `position: fixed; opacity: 0` until `.modal-open`, and
          `.modal-box` inherits that opacity — so a bare `modal-box` rendered in
          flow paints *nothing at all*, which is exactly what the first screenshot
          of this page showed. `static` returns it to the document flow so the
          surface is reviewable next to the card it should be compared with. */}
      <div className="modal modal-open static bg-transparent p-0">
        <div className="modal-box max-w-none p-3">
          <span className="text-xs font-semibold">modal-box</span>
        </div>
      </div>
      <ul className="menu menu-sm rounded-box bg-base-200 p-1">
        <li>
          {/* `menu-active`, not `active`: daisyUI 5 renamed it, and the old class
              is spelled correctly enough to render an unhighlighted row forever. */}
          <button className="menu-active">menu item, active</button>
        </li>
        <li>
          <button>menu item</button>
        </li>
      </ul>
      <div className="space-y-1">
        <div className="alert alert-info py-1.5 text-xs">alert-info</div>
        <div className="alert alert-success py-1.5 text-xs">alert-success</div>
        <div className="alert alert-warning py-1.5 text-xs">alert-warning</div>
        <div className="alert alert-error py-1.5 text-xs">alert-error</div>
      </div>
    </div>
  </section>
)
