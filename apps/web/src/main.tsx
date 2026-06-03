import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { queryClient } from "./lib/query-client"
import { startSse } from "./lib/sse"
import { routeTree } from "./routeTree.gen"
import "./styles.css"

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

startSse(queryClient)

const el = document.getElementById("root")
if (!el) throw new Error("root element missing")

createRoot(el).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
