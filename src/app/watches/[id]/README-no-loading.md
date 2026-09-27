# Why there is no `loading.tsx` here

A `loading.tsx` on this route adds a Suspense boundary around a `force-dynamic`
page. Measured behaviour: after a mutation (rebook, pause, resume), the server
rendered the NEW value every time and the browser intermittently kept the OLD
one committed — a user who had just rebooked still saw their previous price
about a third of the time.

Reproduced with a 6-run loop: 3/6 stale with the boundary, 6/6 correct without
it, with no other change. The E2E suite covers this (`rebooking` and
`pauses and resumes`).

A skeleton is not worth showing someone a price they already changed. If you
want one back, put a `<Suspense>` around an inner data section that is not
affected by a mutation, and re-run the E2E suite several times before trusting it.
