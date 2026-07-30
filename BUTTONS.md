# 88x31 buttons

Everything about the buttons on this site: how they're made, how the wall on the
index page is fed, and what to change to point the generator at somebody else's
site.

Three files do the work:

| file | what it owns |
| --- | --- |
| `make-buttons.py` | draws every GIF in `buttons/` |
| `src/_data/buttons.js` | what hangs on the wall, and where each button links |
| `src/index.njk` | the wall itself, at the foot of the index page |

`.eleventy.js` copies `buttons/` into the build untouched. The generator is *not*
part of `npm run build` — the GIFs are committed, and you regenerate them when
the design changes.

---

## Running it

```sh
python3 make-buttons.py
```

Needs Pillow and two fonts. On Debian:

```sh
python3 -m pip install Pillow
sudo apt install fonts-dejavu-mono fonts-droid-fallback
```

`fonts-dejavu-mono` letters everything; `fonts-droid-fallback` is the only font on
a stock box with katakana in it, and supplies the rain. Both paths are spelled out
at the top of the script.

Nothing is added to `package.json`: wiring this into `npm run build` would put a
Python and Pillow requirement on anyone who just wants to build the site.

It rewrites the buttons it owns and prints what it wrote. Files it doesn't know
about — friends' and collected buttons, which live in the same directory — are
left alone, so a regeneration is safe to run at any time:

```
88x31 foundry
  buttons/sp3ctr-zone.gif  17.6 KB  24 frames
  buttons/sp3ctr-zone-static.gif  1.7 KB  1 frame
  ...
```

Output is **byte-identical across runs**, deliberately — fixed RNG seed, and the
glyph shuffle is mixed by hand rather than with `hash()`, whose value for a tuple
is an implementation detail. This is load-bearing: `./ship.sh --prune` diffs the
build against the live site, and a generator that reshuffled its noise every run
would re-upload seven binaries on every deploy. If you change the drawing code,
keep it deterministic.

---

## The hard limits

88x31 with a 1px bezel leaves an interior of **86x29**. Everything below is
measured against DejaVu Sans Mono Bold at 10px, drawn through a 1-bit mask so it
isn't antialiased — 6.02px per character, 7px cap height, 5px x-height.

Those numbers are not adjustable knobs. Every layout constant in the script is
whole pixels measured against these exact metrics, so changing the font or size
means re-measuring all of them.

### Badge text: 10 characters a line

The text column (`TEXT_BOX`) is 64px wide.

| characters | ink | |
| --- | --- | --- |
| 9 | 53px | fits |
| **10** | **59px** | **fits — the ceiling** |
| 11 | 65px | overflows |

Both lines are centred as a block, 7px caps with a 3px gutter. `CAN'T STOP` at
59px is the widest line currently shipping.

### The wordmark: 13 characters

| characters | ink | |
| --- | --- | --- |
| 12 | 71px | fits |
| **13** | **77px** | **fits — the ceiling** |
| 14 | 83px | refused |

`hero_frames` asserts this rather than trusting it, because a long name doesn't
wrap or shrink — it runs under the bezel and off the side of the button, and the
rain is busy enough that a clipped last letter reads as part of the picture.

### Icons: 13px wide, and clear of the rule

The icon well (`ICON_BOX`) is 13px wide; the divider rule sits at `RULE_X = 18`
with `ICON_CLEARANCE = 3` px reserved between them for the icon's glow. `badge()`
asserts both, and that assertion exists because it was needed — see *sprites*
below.

---

## Adding a badge

1. Append an entry to `BADGES` in `make-buttons.py`:

   ```python
   {
       "name": "small-web-forever",     # becomes buttons/small-web-forever.gif
       "lines": ("SMALL WEB", "FOREVER"),   # <= 10 characters each
       "icon": """
       ...####..
       ..######.
       .########
       """,
   },
   ```

2. `python3 make-buttons.py`
3. Add it to the `badges` array in `src/_data/buttons.js`:

   ```js
   { file: "small-web-forever.gif", alt: "small web forever" },
   ```

4. `./ship.sh`

If a line is too wide or an icon crowds the rule, the script stops and tells you
by how much. It does not silently produce a bad button.

### Sprites

ASCII art, `#` on and anything else off, indented to match the surrounding code —
`sprite()` dedents, so what you read in the source is what lands in the GIF.

Two rules, both learned the hard way:

- **Filled silhouettes, not outlines.** At eleven pixels a 1px outline of a
  padlock is a grey smudge with a hole in it. Mass survives the size; contour
  doesn't. `</>` is the one exception, because strokes are what that glyph *is*.
- **Check the shape, don't trust the ASCII.** A sprite can look right in the
  source and read as something else entirely once rendered at 7x. Three failures
  so far: two interlocking rings read as an infinity sign, a node mesh with
  diagonal edges read as a bare X, and a shield with inset shoulders read as a
  heart. Render it and look before you commit it.

To eyeball one at size, magnify with nearest-neighbour:

```python
from PIL import Image
Image.open("buttons/small-web-forever.gif").convert("RGB") \
     .resize((88 * 7, 31 * 7), Image.NEAREST).save("/tmp/check.png")
```

---

## Adding somebody else's button to the wall

Their artwork, not ours. Two lists in `src/_data/buttons.js`: `friends` for
people you actually know, `collected` for buttons picked up around the web.

1. **Save the GIF into `buttons/`.** Don't point `file` at their server. A
   hotlinked button spends their bandwidth on every load of this page, breaks the
   day they reorganise their site, and hands them a log line for every visitor who
   comes here. This is the same etiquette the index page asks of people taking
   ours, so it would be a poor look to skip it.
2. Add a line:

   ```js
   friends: [
     { file: "their-button.gif", href: "https://example.org/", alt: "example" },
   ],
   ```

`href` is optional — leave it off for a button that's a statement rather than a
door, the way the badges are. `alt` is what a screen reader and a broken-image box
get; use the site's name.

Empty lists render a `// nothing on file yet` line rather than a blank grid, so
it's fine to ship with them empty.

---

## Making buttons for a friend's site

The generator is this site's, not a general tool — but the parts that are
specific to *this* site are few and named. To produce a set for another site:

1. **`WORDMARK`** — the name on the hero button. 13 characters, checked.
2. **The palette block** — `VOID`, `PANEL`, `ASH`, `MAUVE`, `MAGENTA`, `VIOLET`,
   near the top. These are lifted from `css/style.css`; swap in theirs. The rain
   ramp is separate: `TRAIL_COLORS`, head first, four steps.
3. **`BADGES`** — their slogans, same 10-character limit.
4. **`OUT`** — the output directory, if you don't want their GIFs landing in this
   repo's `buttons/`.

What you should *not* need to touch is the layout: the boxes, the rule, the trail
geometry and the loop maths are all about 88x31 rather than about sp3ctr-zone.

Two things to keep in mind if you go further than the list above:

- **The rain loop is seamless by construction, and it's easy to break.** Every
  frame is a pure function of the frame index, and a drop returns to its start
  after `SPAN * FALL` frames. That has to divide `FRAMES` exactly or the last
  frame doesn't hand over to the first and the rain visibly restarts once a loop —
  which, in the corner of someone's sidebar, is the only thing anyone will notice
  about it. There's an assertion at module level; it has already caught one real
  bug (`ROW_PITCH` 7 over 29px rounds *up* to 5 rows if you let it, giving
  `SPAN` 9, which divides neither 24 nor anything else convenient).
- **Columns are staggered, not variable-speed.** Every column falls at one row
  per frame; what differs is where each drop starts. Phases are dealt
  (`i % SPAN`, then shuffled) rather than rolled independently, because 17
  independent draws over 8 buckets reliably leaves some phase unused and another
  picked five times, and those columns then fall in lockstep — a bright
  horizontal rank moving down the button, which is the exact wipe the stagger
  exists to prevent. Fall speed is set by frame duration in `main`, not by the
  geometry.

---

## Shipping

`buttons/` is passthrough-copied, so new GIFs go out with any normal deploy:

```sh
./ship.sh            # test, build, upload
./ship.sh --prune    # ...and delete remote files the build no longer produces
```

`--prune` is what removes a button you've deleted locally from the live site.
Without it, a renamed or dropped GIF lingers on the server indefinitely — which
matters here, because a button someone else has already linked to keeps working
until it's pruned, and that may well be what you want. Preview first with
`./ship.sh --prune --dry-run`.

The URL for a button is `/buttons/<name>.gif`, and it is a **public contract**.
The copy-paste snippet on the index page sends people to
`https://sp3ctr-zone.neocities.org/buttons/sp3ctr-zone.gif` to download, and some
of them will link it directly however politely they're asked not to. Renaming
`sp3ctr-zone.gif` breaks those. Add new names rather than moving old ones.

The live hostname lives in exactly one place, `ORIGIN` in
`src/_data/buttons.js`, which feeds both the snippet's link target and the
download command beside it.
