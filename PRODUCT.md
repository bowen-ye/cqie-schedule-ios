# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing static HTML, CSS, and JavaScript application, delivered as an installable PWA and reused by the Android and iOS native wrappers.

## Users

Chongqing Institute of Engineering students checking their own timetable, primarily on iPhone in short, repeated sessions between classes.

## Product Purpose

Turn the official academic system's dense, overlapping timetable data into a fast, legible personal schedule. Success means a student can identify the next class, time, and room within seconds without courses obscuring one another.

## Positioning

The product reads the student's official timetable but owns the presentation layer: conflicts are detected, dense weeks become a day-focused mobile agenda, and the same cached schedule remains useful offline.

## Operating Context

The school's OAuth client rejects external callback URLs, and its duplicate cross-origin headers make browser API calls fail. The public Safari fallback therefore uses a one-time, user-installed bookmarklet: the student signs in on the official site, invokes the bookmark, and the bookmark reads the current-term schedule on that same origin. It returns only compressed schedule data in a URL fragment that is cleared immediately and accepted only when its device-generated nonce matches. The home-screen entry opens in Safari so it shares the same local storage. Account credentials and tokens never leave official school pages.

## Capabilities and Constraints

- Official CAS/OAuth login and direct read-only timetable API access in the native wrappers.
- Safari fallback through a one-time local bookmarklet because external OAuth callbacks and browser API calls are blocked by the school's configuration.
- Week, today, next-class, course details, offline cache, and manual entries.
- iOS requires the user to perform Safari's final Share > Add to Home Screen action; websites cannot trigger it automatically. The web manifest uses browser display mode so the home-screen entry shares Safari's imported schedule data.
- Mobile schedules must never overlay course content. True conflicts remain visible and explicitly identified.
- The public web surface is deployed, while native App Store/TestFlight distribution remains deferred.

## Brand Commitments

The product name is `cqie课表`. Its language is direct, calm, and student-oriented rather than promotional.

## Evidence on Hand

The repository contains the working Android application, iOS wrapper, official API mappings, and the existing H5 timetable implementation. No fabricated school endorsements or usage claims may be added.

## Product Principles

- Show the next useful fact first.
- Never trade legibility for a seven-column screenshot.
- Keep credentials inside official login surfaces.
- Preserve every returned course, including conflicts and online courses.
- Make offline and failure states useful rather than empty.

## Accessibility & Inclusion

Touch targets must be at least 44px on mobile, text must remain readable without zoom, focus states must be visible, and reduced-motion preferences must be respected.
