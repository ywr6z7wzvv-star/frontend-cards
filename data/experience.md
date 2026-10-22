<!--
  ИСТОРИИ ИЗ ОПЫТА — блок «From my experience» под ответом на карточке.

  Формат:
    ## <id вопроса>          ← id из data/questions.json (например, js-closure)
    текст в markdown         ← **жирный**, `код`, списки
    Пустой раздел или удалённый раздел = блок не показывается.

  Комментарии вроде этого в приложении не видны — пометки для тебя:
    без пометки             — основа из резюме (цифры и факты оттуда), детали додуманы
    «основа: код рабочих проектов» — по коду проектов, привязка к проекту додумана
    «выдумано»              — фантазия, перепиши на свой реальный опыт

  Найти id вопроса: Каталог → открыть вопрос → в адресе #/q/<id>, или поиск по questions.json.
-->

## js-async-await
On the resource planner, the dashboard loaded data as a chain: `await` the user, then `await` the projects, then `await` the assignments. Each call waited for the previous one, even though only the last one actually needed data from the first. I grouped the independent requests into `Promise.all`, so three round trips became one, and the first screen got noticeably faster. Later this moved into TanStack Query, where parallel queries come for free and dependent ones use `enabled`.

**Takeaway:** `await` in a row is sequential by default, so always ask whether the second request really depends on the first.

## js-deep-copy
A real bug from the planner: the "duplicate assignment" feature used spread, `{ ...assignment }`, and the copy shared the nested `periods` array with the original. Editing hours in the copy silently changed the original row in the table until the next refetch. The fix was `structuredClone`, and after that we agreed on a rule: anything that goes into a form as default values gets cloned, and store updates are always immutable.

**Takeaway:** spread is a shallow copy. For nested data use `structuredClone` or immutable updates.

## js-event-loop
On the ERP project, the financial analytics page aggregated a few thousand documents on the client before passing them to the charts. It was one synchronous loop, so the tab froze for about a second and clicks just queued up: a classic long task blocking the event loop. I split the aggregation into chunks and yielded back to the browser between them with `setTimeout` (today I'd use `scheduler.yield()`), and moved the heaviest export logic into a Web Worker. The page stayed responsive while the numbers were calculated.

## js-closure
A stale closure bug in the learning modules on the J&J portal. Autosave ran in a `setInterval` created inside `useEffect` with an empty dependency array, so the callback closed over the state from the first render and kept saving the *initial* answers. QA caught it because progress "reset" after a reload. I fixed it by keeping the latest answers in a `useRef` that the interval reads, and later replaced the interval with a debounced save on change.

**Takeaway:** every render creates a new closure, and timers and listeners keep the one from the render that created them.

## js-browser-storage
On the J&J learning modules, doctors could spend 20–30 minutes on one course, and losing progress on reload was the top complaint. I added autosave: answers went to `localStorage` right away (debounced) as a fast local draft, and to the server through the NestJS API every few steps, so progress followed the user across devices. On load we compared timestamps and took the newest. Auth tokens never went to localStorage; they lived in httpOnly cookies.

And for my own interview trainer I used IndexedDB: it's async, stores structured data, and handles a log of thousands of answers without blocking the main thread.

## js-error-handling
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
On a public financial-literacy project, the SPA loaded server settings with one request at startup. If that request failed, the whole app showed a blank screen. I made it resilient: a 10-second timeout, then a fallback to typed `DEFAULT_SETTINGS`, and every field is normalized, so a missing or wrong-type value is replaced with the default and components never check for `undefined`. On top of that, an axios interceptor maps HTTP errors to user-friendly toasts, and error boundaries wrap independent widgets.

**Takeaway:** decide for each failure what the user should see. A blank screen is never the right default.

## js-polyfills
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
On a government educational portal we had a real requirement to support old browsers: some users were on outdated school and office machines. The project was on Create React App with explicit polyfills: `whatwg-fetch`, `Element.closest`, smooth `scroll-behavior`, `classList` on SVG. I learned to check browserslist and analytics first and polyfill only what's actually used. Otherwise you ship extra kilobytes to everyone for a few percent of users.

## js-promise-all-impl
<!-- выдумано -->
This came up in practice on the hockey platform: team managers uploaded a pack of documents, 20–30 scans per team, for review. Firing all uploads at once with `Promise.all` overloaded the server, and one failure rejected everything. I wrote a small concurrency-limited queue, three uploads at a time, with `allSettled` semantics, so the user saw which files failed and could retry only those.

## html-script-async-defer
On the J&J portal, marketing kept adding third-party scripts: analytics, a cookie consent banner, a video player SDK. Some were plain blocking `<script>` tags in the head, and LCP suffered. I audited them: analytics moved to `next/script` with `afterInteractive`, non-critical widgets to `lazyOnload`, and the consent banner stayed early because it's legally required before any tracking. That alone gave a visible win in Lighthouse without touching our own code.

## br-event-delegation
<!-- выдумано -->
The tournament summary table on the hockey platform could have hundreds of rows, each with clickable result cells. At first every cell had its own handler. I moved to one handler on the table body that reads `data-match-id` from `event.target.closest('td')`: fewer listeners, simpler code, and it works for rows added by pagination. In React this matters mostly for non-React widgets, since React already delegates events to the root.

## perf-memory-leaks
QA on the J&J portal noticed the learning modules got slower after several lessons without a reload. In the DevTools Memory tab I took heap snapshots before and after navigating between lessons and saw detached DOM nodes and a growing number of carousel instances. The carousel and a `resize` listener were never destroyed on unmount. Proper cleanup in the `useEffect` return (`swiper.destroy()`, `removeEventListener`, aborting pending fetches) flattened the memory graph.

**Takeaway:** every subscription needs an owner who unsubscribes.

## css-specificity
While our frontend still lived inside the Drupal theme, our components fought with CMS styles: Drupal had selectors like `#main .region .block a`, and people answered with `!important`. I moved our components to CSS Modules with flat, single-class selectors and wrapped the legacy theme in a cascade layer, `@layer legacy`, so our unlayered styles win regardless of specificity. The number of `!important`s dropped from a few dozen to almost zero.

## css-bem
On the hockey platform the styles were global SCSS with BEM, like `tournament-card__title--active`. BEM worked while the team was small, but we still got collisions when two developers picked the same block name. During the migration to Next.js we switched to CSS Modules: class names became local, and BEM-style naming stayed only as a convention inside a module. I'd still pick BEM for a plain HTML or CMS site without a build step.

## css-preprocessors
My best example is theming on the J&J portal. The business wanted to change the site palette without a release. I built it on SCSS maps: palettes and component variants are described as maps, and an `@each` loop generates CSS Custom Properties from them. The admin panel stores the palette, the server injects it as CSS variables, and components only read `var(--color-primary)`. A new button variant became one entry in the config instead of a new stylesheet.

## css-mixins
In the same theming system on the J&J portal, a mixin generated a full component variant from config: `@include button-variant($bg, $text, $hover)` produced the base, hover, `:focus-visible` and disabled states. Before that, each new variant was 40 lines of copy-paste, and someone always forgot the focus style. With the mixin, a variant is one line and the accessibility states come for free.

## css-z-index
A classic bug from the J&J portal: a modal appeared *under* the sticky header even though it had `z-index: 9999`. The reason was a stacking context: the modal was rendered inside a container with `transform`, so its z-index only competed inside that container. I moved modals to a portal at the end of `body` and introduced a small z-index scale in SCSS variables (`dropdown`, `sticky`, `modal`, `toast`) instead of random big numbers.

## css-position
<!-- выдумано -->
The tournament standings table on the hockey platform had 20+ columns, and on mobile we needed the header row and the team name column to stay visible while scrolling. I used `position: sticky` with `top: 0` for the header and `left: 0` for the first column, with an explicit background so the content doesn't show through. The gotcha: `overflow: hidden` on a parent broke sticky. It has to live inside the actual scroll container.

## css-vh-vw
The interactive learning modules on the J&J portal had a full-screen layout with `height: 100vh` and the "Next" button pinned to the bottom. On iPhone the button hid behind Safari's toolbar, because `100vh` is the largest viewport, with the toolbar collapsed. I switched to `100dvh` with a `100vh` fallback and added `env(safe-area-inset-bottom)` for the home indicator.

## css-heavy-properties
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
On pharma landing pages we had cards that animated `box-shadow` and `top` on hover, and on mid-range Android phones the animation stuttered. The Performance panel showed layout and paint on every frame. I rewrote it to animate only `transform` and `opacity`: the shadow sits on a pseudo-element and only its opacity changes. That runs on the compositor, and the animation became smooth.

## css-fluid-layout
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
For landing pages I use fluid typography and spacing with `clamp()`, for example `font-size: clamp(1.5rem, 1rem + 2vw, 2.5rem)`, instead of five media queries for every heading. On one project this cut the number of breakpoint overrides roughly in half, and the layout looked right on in-between sizes the designers never drew, like tablets in landscape.

## html-semantics
Two cases where it really mattered. On the hockey platform, after moving to SSR, we fixed the markup: one `h1` per page, `main`, `nav`, a real `table` for standings. It helped SEO. On the J&J portal, while building the accessible version, I saw that screen reader users navigate by landmarks and headings, and a `div` with an `onClick` was invisible to them until we replaced it with a `button`.

## css-bootstrap
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
The internal resource planner I inherited was built on React Bootstrap. For an internal tool it's a reasonable choice: the grid, forms and modals are ready, and nobody needs a unique design. We customized it through Bootstrap's SCSS variables rather than fighting the CSS with overrides. For a public branded product I'd rather use a headless library plus our own design system.

## css-custom-checkbox
In the accessible version of the J&J portal, custom checkboxes in quizzes were `div`s with background images: not focusable and not announced by screen readers. I rebuilt them the right way: a real `input type="checkbox"`, visually hidden but still in the accessibility tree, a styled `span` next to it via `input + span`, and `:focus-visible` styles. Keyboard and screen reader support came for free.

## react-state-manager
On the resource planner everything lived in global stores, including server data, so screens fell out of sync and requests were duplicated. I split state by type: server state went to TanStack Query (caching, deduplication, invalidation after mutations), shared UI state like the selected period and filters went to a small Zustand store, and form state went to React Hook Form. The stores shrank to a few small slices. On the earlier ERP project we used Redux Toolkit with RTK Query, which is the same idea inside Redux.

## react-local-vs-global
My rule after refactoring the planner: start with local state, lift it only when two distant components need it, and never copy server data into a global store. In the planner a modal's open flag lived in the global store "just in case", and toggling it re-rendered half the app. Moving it back into the component fixed that. What stays global: the current user, the selected period that several pages share, and the theme.

## redux-thunk
On the ERP project, API calls were hand-written thunks: each one dispatched pending, fulfilled and rejected manually and stored data in slices. Lots of boilerplate and no caching. I migrated them to RTK Query: endpoints became declarative, and we got caching, request deduplication and tag-based invalidation after mutations. Page load dropped by about a second, mostly because we stopped refetching the same reference data on every page.

## react-useeffect
The planner had "effect chains": one `useEffect` fetches data and sets state, another watches that state and fetches something else. That caused races: changing filters quickly could show results from an older request. I moved data fetching to TanStack Query, where the key includes the filters and outdated requests are cancelled, and removed effects that only derived state; those became plain calculations during render. About half of the `useEffect`s in the project went away.

## react-usememo
A practical case from the planner: the TanStack Table column definitions were re-created on every render, so typing in the search box re-rendered every cell. Wrapping `columns` and the processed `data` in `useMemo` fixed it. But I don't memoize by default, only when a value is expensive to compute or goes into a memoized child or a dependency array.

## react-memo
In the planner table I wrapped row components in `React.memo`, but it only helped after I made the props stable. Before that, an inline `onEdit={() => …}` broke memoization on every render. That's my usual point: `React.memo` without stable props does nothing, so I check with the Profiler first.

## perf-rendering-react
In the planner, typing in the filter input made the whole summary table lag. I opened the React DevTools Profiler with "highlight updates" and saw every keystroke re-render all 500+ rows: the filter state lived in the parent, columns were re-created each render, and row callbacks were new functions. I moved the input state down, memoized columns and data, wrapped rows in `React.memo` and deferred the filter value with `useDeferredValue`. Typing became instant.

## react-usecontext
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
On the financial-literacy project we used context for app-wide values that rarely change: server settings loaded at startup, the theme, and an "impaired vision mode" flag that switched the whole UI to large fonts and high contrast. I deliberately kept frequently changing data out of context, because every consumer re-renders when the value changes. For that we had a store.

## react-controlled
The planner's assignment form had about 40 fields, including dynamic rows of periods. It was fully controlled with `useState`, and every keystroke re-rendered the whole form. I moved it to React Hook Form, which is uncontrolled under the hood: inputs keep their own value and the form reads it through refs, with Zod schemas for validation. The typing lag disappeared, and the form code shrank by about a third.

## react-keys
A bug from the drag-and-drop questions in the learning modules: the list of answer options used the array index as `key`. After the user reordered items, the text in the inputs stayed in place while the items moved, because React matched elements by position. Switching to stable ids from the data fixed it.

## react-error-boundary
On the J&J portal one page could include several independent interactive modules from the CMS. One broken module, say with bad CMS data, unmounted the whole page. I wrapped each module in an error boundary with a small fallback ("This block couldn't load") and error reporting, so one failing widget no longer took down the page.

## react-concurrent
In the planner, the employee search filtered a big list on the client. I used `useDeferredValue` for the query: the input updates immediately, and the heavy list re-renders with the deferred value at a lower priority, so typing never blocks. For switching between heavy tabs, `useTransition` kept the old tab interactive while the new one rendered.

## react-19
I migrated the resource planner to React 19 and Next.js 16 without pausing feature work: updated dependencies and fixed breaking changes in a branch, removed deprecated APIs, then shipped. After that we started using what React 19 offers: `ref` as a regular prop instead of `forwardRef`, `useActionState` for a couple of simple forms. Together with moving tables to TanStack Table and forms to React Hook Form, the UI loads about 30% faster by Lighthouse.

## react-patterns
For the J&J component library, which lived in a separate repository, we used compound components for complex pieces, for example `<Accordion>`, `<Accordion.Item>` and `<Accordion.Trigger>` sharing state through context, so CMS-driven pages could compose them freely. For variants we used a config: one `variant` prop mapped to generated styles instead of ten boolean flags like `isPrimary` and `isLarge`.

## vue-composition-api
<!-- выдумано: Vue-проекта нет в резюме — подставь свой -->
On an earlier Nuxt project, filter and pagination logic was spread across three mixins, and in a component you couldn't tell where `this.page` came from. Once two mixins even overwrote each other's `loading`. During the move to Vue 3 I rewrote them as composables, `usePagination` and `useFilters`, that return explicit refs. Name collisions disappeared, TypeScript inferred the types, and the logic became easy to test on its own.

## vue-reactivity
<!-- выдумано -->
A bug I hit after migrating to Vue 3: a colleague destructured a reactive object, `const { items } = reactive(state)`, and the list stopped updating, because destructuring pulls plain values out of the proxy. The fix was `toRefs`, or simply using `ref`. Since then the team preferred `ref` everywhere: it's explicit, and `.value` reminds you that the value is reactive.

## vuex-purpose
<!-- выдумано -->
On a Nuxt project we had Vuex with modules for the user, the cart and the catalog. Over time most of it turned out to be server data copied into the store. When we moved to Vue 3, we replaced Vuex with Pinia for the small amount of real client state and moved server data into composables with caching. Pinia dropped mutations as a separate concept and gave us proper TypeScript support.

## vue-deep-watch
<!-- выдумано -->
On an admin panel someone added a `deep: true` watcher on a big filters object with nested arrays to sync it with the URL. It fired on every tiny change and traversed the whole object each time, and the page got sluggish. I replaced it with a watcher on a getter that returns only the fields we need, `() => [filters.status, filters.page]`, and URL syncing became cheap.

## gen-rest
At EPAM I align API contracts with the backend before work starts: we agree on endpoints and DTOs in Swagger, so the frontend can build against mocks in parallel. On the J&J portal, the NestJS layer over Drupal made the API resource-oriented and predictable, so the frontend didn't need to know Drupal's internals. When the CMS changed its data contract, only the mapping in NestJS changed, not the client.

## gen-put-patch
<!-- выдумано -->
In the planner, saving an assignment originally used PUT with the whole object, and two managers editing different fields at the same time overwrote each other's changes. We switched to PATCH with only the changed fields, plus a `version` check on the backend that returns 409 on conflicts. I built the PATCH body from React Hook Form's dirty fields.

## gen-websockets
<!-- выдумано -->
On the hockey platform we discussed live scores for referees and spectators. WebSockets would have needed new backend infrastructure, and scores change maybe once a minute. We chose polling through TanStack Query with a 15-second `refetchInterval`, only on the live match page and paused when the tab is hidden. It took a day instead of weeks and was enough for the use case. For chat or real-time collaboration I'd pick WebSockets or SSE.

## gen-merge-rebase
On the J&J project, with 8 frontend developers, the rule was: rebase your feature branch on main before the merge request, then squash-merge. History stayed linear, every feature was one commit, easy to find and revert. Rebase only your own branches, never shared ones.

## gen-design-patterns
The pattern I used most deliberately is an adapter (mapper) layer. In the J&J NestJS service we mapped raw Drupal responses into clean DTOs, so the frontend never saw CMS internals. When the CMS changed its data contract, I migrated the user account area by changing the mappers, and the React components didn't change at all. On the frontend I also use facades, like a single `api` module that hides axios and interceptors.

## ts-why
When I took over the planner, there were dozens of `any`s, and bugs like "undefined is not a function" reached production whenever the backend renamed a field. I removed every `any`, typed the API responses and turned on strict mode. The biggest win was refactoring: during the React 19 and TanStack Table migration, the compiler pointed to every place that needed a change. The cost is time spent on types and a learning curve, but on a project you maintain for years it pays off fast.

## ts-any-unknown-never
While removing every `any` from the planner, the rule was: anything from outside (API responses, `JSON.parse`, `catch (e)`) is `unknown` until it's validated or narrowed. And I use `never` for exhaustive checks: in a `switch` over assignment statuses, the `default` branch assigns to `never`, so when the backend added a new status, the build failed exactly where we had to handle it.

## ts-generics
In the planner I wrote a generic table wrapper over TanStack Table, `DataTable<TRow>`, where columns, sorting and row actions are typed by the row type, so `row.original` is fully typed in every cell. Same with a small `useApiQuery<TResponse>` hook. One component serves the employees, projects and assignments tables without a single `any`.

## ts-discriminated-unions
The learning modules had several question types: single choice, multiple choice, drag-and-drop matching, free text. I modeled them as a discriminated union on `type`, so in the renderer `switch (question.type)` narrowed the shape: for `dragdrop` TypeScript knew about `pairs`, for `single` about `options`. Plus an exhaustive `never` check, so a new question type from the CMS forced us to handle it everywhere.

## ts-strict-config
You can't turn on `strict` in a legacy project in one day. In the planner I enabled flags one at a time: first `noImplicitAny`, then `strictNullChecks`, which found real bugs with optional API fields, and `noUncheckedIndexedAccess` at the end. Each step was its own merge request, so it never blocked feature work.

## ts-runtime-validation
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
TypeScript types disappear at runtime, and the backend can still send something unexpected. On one project we validated forms and critical API responses with Zod and inferred types from the schemas with `z.infer`, so there was one source of truth. On another we normalized server settings field by field and replaced anything missing or of the wrong type with a default, so bad data never crashed the UI.

## perf-web-vitals
My best example is the player and team catalog on the hockey platform. The page rendered every player at once, and the HTML was 26–28 MB. I moved it to server-side pagination with filters loaded on the client and kept the pages indexable. FCP went from 2.3 to 0.3 seconds, LCP from 2.8 to 0.5, and the Lighthouse score from 39 to 78. I measured before and after on the same throttling profile, so the numbers are comparable.

## perf-bundle
On the J&J portal, the interactive learning modules chunk was 10 MB. The bundle analyzer showed that images and animations were imported straight into the code and inlined into the JS. I moved all static assets to the CDN and loaded them by URL, and the modules themselves were lazy-loaded with dynamic imports. The chunk went from 10 MB to 78 KB.

## perf-images
On the J&J portal, all static assets, images included, were served by the Node containers with no compression and no caching. I moved them to a CDN using Next.js `assetPrefix`, a Dockerfile step and a shell script that uploads the build. Over 95% of outgoing traffic moved off the frontend service, about 17 TB a year. On top of that: modern formats through `next/image`, explicit sizes to avoid layout shift, and `loading="lazy"` below the fold.

## perf-long-lists
I've solved this two ways. On the hockey platform, the catalog of 10,000+ players got server-side pagination, because people search and filter rather than scroll through everything, and it was better for SEO. In the planner, where one view showed a long list of employees, I used virtualization and rendered only the visible rows. The choice depends on whether users really need the whole list on screen.

## perf-debounce-throttle
In the hockey platform catalog, every keystroke in search fired a request, and responses could arrive out of order. I added a 300 ms debounce on the query and cancelled the previous request with `AbortController`; TanStack Query hands you the `signal` for that. Server load dropped and the flicker of stale results disappeared. Throttle I used for scroll handlers, like the sticky header.

## perf-caching
The CDN story is the main one. On the J&J portal, static assets had no caching headers. After the move to the CDN, hashed files from `_next/static` got `Cache-Control: public, max-age=31536000, immutable`, and HTML stayed `no-cache` with revalidation, so a new deploy shows up immediately but assets are never downloaded twice. On the client, TanStack Query added a cache for API data with a `staleTime` per query.

## perf-web-workers
<!-- выдумано -->
On the ERP project, exporting a big client table to Excel froze the page for several seconds, because the file was generated synchronously on the main thread. I moved generation into a Web Worker: the main thread sends the rows, the worker builds the file and returns a Blob. The UI stayed responsive and showed a progress indicator.

## perf-critical-path
On the hockey platform, public tournament pages were client-rendered on Create React App: users saw a blank page until the bundle loaded and the data arrived. I made the case for migrating to Next.js 14 with SSR, and we did it as a team. HTML now arrived with content, first paint got much faster, and the pages were indexed. Then the usual: preloading the main font, deferring third-party scripts, code-splitting heavy admin modules.

## perf-fonts
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
On pharma landing pages, fonts came from a third-party CDN, which meant an extra connection and invisible text while loading. I self-hosted them in `woff2`, subset to Latin and Cyrillic, added `font-display: swap` and preloaded only the main weight. In Next.js, `next/font` does all of this automatically, including size-adjusted fallbacks that prevent layout shift.

## br-pwa
I built one myself: this interview trainer. It's a static app on GitHub Pages with a web manifest, a service worker with a network-first strategy, so updates arrive right away and it still works offline, and progress stored in IndexedDB. On iPhone it installs through "Add to Home Screen" and runs full screen. The iOS limitations I ran into: there's no install prompt, the installed app's storage is separate from Safari, and push notifications only work for installed apps.

## br-observers
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
On the financial-literacy portal we used `IntersectionObserver` to lazy-load images, animate blocks as they appear, and for analytics: a banner counted as "seen" only when half of it was visible for a second. In the planner I used `ResizeObserver` so charts and table columns recalculated when the side panel collapsed, because `window.resize` doesn't fire in that case.

## br-fetch-abort
In the planner, switching filters quickly caused a race: a slow old request could finish after the new one and overwrite the result. With TanStack Query the key includes the filters and the fetcher gets an `AbortSignal`, so outdated requests are cancelled. Before Query I did it by hand: an `AbortController` in the effect and `abort()` in the cleanup.

## sec-xss
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
On the J&J portal a lot of content came from the CMS as HTML, and editors could paste anything. Rendering it with `dangerouslySetInnerHTML` directly was a risk. We sanitized it with DOMPurify (`isomorphic-dompurify`, so it works during SSR too) using an allowlist of tags and attributes, then parsed it into React elements with `html-react-parser`, so links and images went through our own components.

## sec-cors
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
In local development our SPA ran on localhost and the API on a dev server, so the browser blocked requests by CORS. Instead of asking the backend to allow localhost, I set up the Vite dev server proxy: the browser calls `/api` on the same origin and Vite forwards it to the dev backend. In production the frontend and the API are on one domain, so no CORS is needed at all.

## sec-auth-tokens
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
The planner uses SSO through Keycloak. We didn't keep tokens in localStorage, where any XSS could read them. Authentication goes through the backend, which keeps the session in an httpOnly, Secure, SameSite cookie, and the frontend just sends requests with credentials. On a 401 we redirect to the SSO login.

## sec-clickjacking-misc
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
A few things from practice beyond XSS. Bot protection: on one project lead forms got spammed, and we added Yandex SmartCaptcha plus server-side rate limiting. Dependency hygiene: `npm audit` in CI and regular updates. And never trusting the client: role checks in the hockey platform's UI were only for UX, and real access control lived on the backend.

## arch-rendering
I've used all of them. On the hockey platform, public tournament pages moved from CSR to SSR for SEO and first paint, while the admin and referee interfaces stayed client-side: no SEO needed, heavy interactivity. On the J&J portal, CMS content pages were statically generated with revalidation (ISR), so editors' changes appeared within minutes without a rebuild, while account pages were SSR. My rule: decide per page, based on how often the data changes and whether it needs SEO.

## arch-hydration
<!-- выдумано -->
After moving the hockey platform to SSR we got hydration mismatches on match schedules: the server rendered times in UTC, the browser in the user's timezone. We fixed it by formatting dates in one fixed timezone, the tournaments' local time, on both sides. Other sources were `Math.random()` ids and `localStorage` reads during render; those moved to `useId` and `useEffect`.

## arch-rsc
On the J&J portal's Next.js app with the App Router, pages are server components by default: they fetch from the NestJS layer directly, and their code never ships to the client. Interactivity (forms, learning modules, the theme switcher) lives in small `'use client'` islands. The main lesson: keep the client boundary as low in the tree as possible, because everything below it becomes client JavaScript.

## arch-micro-frontends
On the J&J portal the frontend lived inside the Drupal monolith, and that slowed everything down: shipping a frontend change meant deploying the CMS. I initiated extracting it into a standalone Next.js app with a NestJS layer over the CMS API. We discussed micro-frontends and decided against them: one team, one product. What we actually needed was deploying the frontend independently from the CMS, and micro-frontends would have added complexity without a benefit.

## arch-project-structure
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
On my recent projects we use Feature-Sliced Design or a lighter version of it: `app`, `widgets`, `features`, `entities`, `shared`, and layers only import from below. On a legacy project we moved to it gradually: new code went into the new structure, old components moved when someone touched them, and a lint rule blocked imports in the wrong direction. The biggest win is that it's always obvious where new code goes.

## arch-design-system
The J&J component library lived in a separate repository and was published as a package. Tokens (colors, spacing, typography) were CSS Custom Properties generated from SCSS maps, so theming worked at runtime from the admin panel. Components were accessible by default, and variants were defined in a config. The pain point was versioning across two repos: every fix needed a release and a version bump in the app.

## arch-observability
<!-- выдумано -->
On the J&J portal we had Sentry for errors, with source maps uploaded in CI and release tags, so we could see which deploy introduced an error. For performance we collected real-user Web Vitals with the `web-vitals` library and sent them to analytics, because lab Lighthouse scores and real users' numbers differ a lot.

## arch-feature-flags-cicd
<!-- частично выдумано (флаги) -->
On the J&J project, the GitLab CI pipeline ran lint, type checks, tests and the build on every merge request, then built a Docker image and uploaded static assets to the CDN. For risky changes like the new theming we used feature flags from the CMS config, so we could ship the code switched off and turn it on for one page first.

## test-strategy
When I inherited the planner, there were no tests at all. I set up Vitest and React Testing Library and started where bugs were most frequent and most expensive: business logic, like hours and date calculations for assignments, as unit tests, then integration tests of key screens with a mocked API. A pre-commit hook runs ESLint, type checks and tests. We ended up with 80+ test files and about 90% coverage, but the real result was that refactorings like the React 19 migration went through without regressions.

## test-rtl
In the planner tests I follow the Testing Library approach: test what the user sees and does. Find elements by role and label, `getByRole('button', { name: 'Save' })`, type with `userEvent`, and assert on the visible result, not internal state. A nice side effect: if a test can't find an element by role, that's usually an accessibility problem in the component.

## test-mocking
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
In the planner we mock at the network boundary: the API client is mocked and integration tests get realistic fixtures, so components, hooks and TanStack Query run for real. We don't mock our own components or hooks. For dates we use fake timers, because a lot of the logic depends on the current week.

## test-hooks
I test the planner's custom hooks built on TanStack Query with `renderHook` and a wrapper that creates a fresh `QueryClient` with `retry: false` for every test. Otherwise the cache leaks between tests and failing requests retry for seconds. Pure logic I pull out of hooks into plain functions and unit-test separately, which is simpler than testing it through a hook.

## test-e2e
<!-- выдумано -->
On the J&J project we had 9 QA engineers, so most of the E2E coverage was theirs. On my side I wrote a few Playwright smoke tests for the critical path (log in, open a learning module, answer, get the certificate) that ran in CI before a release. To keep them reliable: `data-testid` only where roles don't work, no fixed timeouts, and a dedicated test user with seeded data.

## a11y-basics
On the J&J portal I built the accessible version for visually impaired users: larger fonts and high contrast, full keyboard navigation, visible focus, ARIA where native elements weren't enough, and focus management in modals. I tested with VoiceOver and keyboard only. The biggest findings weren't exotic: inputs without labels, `div`s used as buttons, and images without `alt`.

## a11y-aria
The trickiest case was the drag-and-drop questions in the learning modules, which are unusable with a keyboard or a screen reader out of the box. I added a keyboard alternative: focus an item, Space to pick it up, arrows to move, Space to drop, with an `aria-live` region announcing "Item moved to position 3". But my first rule is native elements first, and ARIA only when there's no native option.

## a11y-focus
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
In the learning modules I used a focus trap in modals (`focus-trap-react`): Tab stays inside, Escape closes, and on close focus returns to the button that opened the modal. On route changes in the SPA we moved focus to the new page's main heading, otherwise screen reader users don't notice that the page changed.

## tool-bundlers
<!-- основа: код рабочих проектов, привязка к проекту додумана -->
I've worked with both. The financial-literacy portal was on Create React App with webpack: the dev server took about a minute to start, and HMR was slow. Newer projects are on Vite: instant start because it serves native ES modules in development, and Rollup for the production build. When migrating, the main work was environment variables (`process.env` to `import.meta.env`) and a few CommonJS-only dependencies.

## tool-tree-shaking-splitting
On one project the bundle analyzer showed all of `lodash` in the main chunk because of `import _ from 'lodash'`. Switching to `lodash-es` with named imports let tree shaking drop the unused code. For code splitting, the J&J learning modules and the heavy admin pages on the hockey platform were loaded with dynamic `import()`, so a regular visitor never downloads them.

## tool-monorepo
On the J&J project the component library lived in a separate repo, and that hurt: to fix a button you opened a merge request in the library, waited for a release, bumped the version in the app, and only then saw the fix in context. I proposed a monorepo with pnpm workspaces, so the app uses the library from source. If I were setting it up from scratch today, I'd start with a monorepo and Turborepo or Nx for build caching.

## tool-linting
On the J&J project, broken builds and untyped code kept landing in shared branches and blocking 8 frontend developers. I initiated and rolled out ESLint, Prettier and Husky with lint-staged: a pre-commit hook runs lint, type check and tests on changed files, and CI repeats the checks. I introduced it step by step: warnings first, then one big auto-format commit, then errors. After that, broken builds stopped blocking teammates.

## beh-tell-about-project
The most complex one was the J&J portal: 300K+ visitors a month, 8 frontend developers, and a frontend living inside a Drupal monolith. I made the case for extracting it into a standalone Next.js app with a NestJS layer over the CMS API and took part in the design and implementation. In parallel I moved static assets to a CDN, which took over 95% of outgoing traffic off the frontend service, about 17 TB a year, and built theming the business can change from the admin panel. The hard part wasn't one technology. It was changing the architecture of a live, high-traffic product while 8 people kept shipping features.

## beh-disagreement
<!-- выдумано: подставь свою реальную историю -->
On the hockey platform the team lead wanted to keep public pages on Create React App and add pre-rendering through a third-party service for SEO. I disagreed: it was a workaround that left us with a slow first paint and one more moving part. Instead of arguing in the abstract, I built a small proof of concept, one tournament page on Next.js with SSR, and compared Lighthouse scores and indexing. The numbers convinced him, and we migrated together. And when I turn out to be wrong, I say so. The goal is the best decision, not winning the argument.

## beh-code-review
I review in order: does it solve the task, is it correct on edge cases (empty data, errors, loading), then architecture, and only then style, which should be the linter's job anyway. I mark comments by priority, blocker or nit, and explain why, often with a link or a snippet. On the J&J project, once formatting was automated, reviews became about logic instead of commas, and they got faster.

## beh-mentoring
On the hockey platform I onboarded a junior developer. Instead of handing over documentation, we paired on a small real task in the first week. Then I gave tasks slightly above their level with a clear definition of done and reviewed the code with explanations, not just "fix this". After about two months they were shipping small features on their own. At EPAM I also do onboarding and technical interviews.

## beh-estimation
I break a task into pieces no bigger than a day (API, UI, states, tests), estimate each one and add a buffer for unknowns. If there's a big unknown, I start with a short time-boxed spike. On the planner I was the only frontend developer, so I learned to say early: "this is 5 days, not 3, because the API isn't ready, and here's what we can cut". Raising a risk on day one is always better than on the deadline.

## beh-tech-debt
The planner is my main example: an outdated codebase, no tests, `any` everywhere. Instead of asking for a "refactoring sprint", I bundled improvements with features: whenever I touched a screen, I moved it to TanStack Query and covered it with tests. The big migration to React 19 and Next.js 16 happened without pausing feature work. And I backed it with numbers (the UI loads 30% faster, duplicate requests are gone) so the business could see the value.
