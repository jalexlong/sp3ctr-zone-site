#!/usr/bin/env python3
"""sp3ctr-zone :: the 88x31 button foundry

    python3 make-buttons.py

Writes every GIF in buttons/ from scratch. Nothing in that directory is hand
edited — if a button looks wrong, it's wrong here.

WHY A SCRIPT AND NOT A DRAWING

88x31 is small enough that every pixel is a decision, and a decision made in a
paint program is one nobody can review. Here the corner brackets are the same
four lines of code as the .panel corners in the stylesheet, the palette is the
site's six colours by name, and "make the glow one pixel tighter" is a diff.

Only Pillow is imported, and only the fonts already installed on the machine are
used, so this needs no package.json entry and doesn't run during `npm run build`
— the GIFs are committed. Regenerate them when the design changes, not on every
deploy.

DETERMINISM

The rain is random but the seed is fixed, so a rebuild produces byte-identical
files. That matters more than it sounds: `npm run deploy` diffs the build against
the live site, and a generator that reshuffled its noise every run would re-upload
six binaries every single deploy.
"""

import random
import textwrap
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).parent / "buttons"

# --- the palette -----------------------------------------------------------
#
# Lifted straight from css/style.css :root. A button that ships in someone
# else's sidebar is the only piece of this site that gets seen out of context,
# so it had better be recognisably the same object as the site itself.

VOID = (0x0B, 0x07, 0x10)
PANEL = (0x16, 0x10, 0x1F)
ASH = (0xCB, 0xB8, 0xD6)
MAUVE = (0x9C, 0x7A, 0x9E)
MAGENTA = (0xFF, 0x2E, 0xC4)
VIOLET = (0x7C, 0x3A, 0xED)

W, H = 88, 31  # the whole point

# --- fonts -----------------------------------------------------------------
#
# DejaVu Sans Mono Bold at 10px is the one that survives being drawn without
# antialiasing: two-pixel stems, a 7px cap height, and a 5px x-height that still
# has a hole in the 'e'. JetBrains Mono — the face the site itself uses — loses
# its 's' at this size, so the button is lettered in the nearest thing that
# holds up. Sizes are not adjustable knobs: every layout below is measured in
# whole pixels against these exact metrics.
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

# The only font on a stock Debian box with katakana in it. Half-width kana
# (U+FF66..U+FF9D) rather than full-width: at 9px a full-width glyph is 9px wide
# and the rain gets 9 columns, where half-width gets 17. Rain needs columns.
KANA_FONT = "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"

TITLE = ImageFont.truetype(MONO, 10)
BADGE = ImageFont.truetype(MONO, 10)
KANA = ImageFont.truetype(KANA_FONT, 9)

# Deliberately the angular, low-stroke-count half of the syllabary. The round
# ones (ｵ ｸ ｿ) turn to mush at 9px; these keep a readable silhouette, which is
# the whole reason to use kana instead of random punctuation.
GLYPHS = "ｱｲｴｶｷｹｺｻｼｽﾆﾈﾊﾋﾎﾏﾐﾑﾔﾜﾝ7031"


# --- drawing helpers -------------------------------------------------------


def ink(text, font):
    """A crisp bilevel mask of `text`, cropped to its ink, as mode "L".

    Drawing onto a mode-"1" image is what buys the crispness: Pillow picks its
    glyph mask mode from the target, so a 1-bit target gets a 1-bit,
    unantialiased mask. Draw the same string onto an "L" and every stem comes
    back with grey shoulders, which at a 5px x-height is most of the letter.
    """
    left, top, right, bottom = font.getbbox(text)
    scratch = Image.new("1", (right - left + 2, bottom - top + 2), 0)
    ImageDraw.Draw(scratch).text((1 - left, 1 - top), text, font=font, fill=1)
    return scratch.crop(scratch.getbbox()).convert("L")


def sprite(art):
    """A mask from ASCII art — '#' is on, everything else is off.

    The badge icons are around a dozen pixels wide. At that size an ASCII block
    is not a shortcut, it's the most honest possible representation: what you
    read in this file is what lands in the GIF.

    The dedent is not cosmetic. Without it the eight spaces that indent these
    blocks inside BADGES became eight real columns of the sprite: every icon came
    out 8px wider than drawn with its ink shoved to the right, which pushed all
    five of them up against the divider rule. The art *looked* correct in the
    source, which is exactly why it took a measurement to find.
    """
    rows = [row for row in textwrap.dedent(art.strip("\n")).split("\n") if row.strip()]
    width = max(len(row) for row in rows)
    mask = Image.new("L", (width, len(rows)), 0)
    mask.putdata([255 if x < len(row) and row[x] == "#" else 0
                  for row in rows for x in range(width)])
    return mask


def stamp(target, mask, xy, color):
    """Paste a flat colour through `mask`. The mask is the shape, nothing else."""
    target.paste(color, xy, mask)


def glow(target, mask, xy, color, radius=1.6, strength=0.85):
    """Screen a blurred copy of `mask` under itself, in `color`.

    Screen rather than paste, because a glow has to brighten what it lands on
    without occluding it — the rain has to stay visible through the halo around
    the wordmark, or the title reads as a sticker sitting on top of a separate
    picture instead of as light coming off the same screen.
    """
    halo = Image.new("L", target.size, 0)
    halo.paste(mask, xy)
    halo = halo.filter(ImageFilter.GaussianBlur(radius))
    if strength != 1:
        halo = halo.point(lambda v: int(v * strength))

    lit = Image.new("RGB", target.size, color)
    return ImageChops.screen(target, Image.composite(lit, Image.new("RGB", target.size), halo))


def centered(mask, box):
    """Top-left corner that centres `mask` in `box` = (x, y, w, h).

    Rounds x down and y down, so a mask that can't be exactly centred sits one
    pixel left and one pixel high rather than one right and one low. Consistent
    bias beats correct-on-average when there are only 31 rows to be wrong in.
    """
    x, y, w, h = box
    return (x + (w - mask.width) // 2, y + (h - mask.height) // 2)


def screen_lines(img, period=3, strength=0.22):
    """The stylesheet's scanlines, at button scale.

    Every third row rather than every other: at 1-in-2 a 29px-tall interior
    loses half its vertical resolution and the kana stop being glyphs.
    """
    shade = Image.new("L", img.size, 255)
    draw = ImageDraw.Draw(shade)
    for y in range(0, img.height, period):
        draw.line([(0, y), (img.width, y)], fill=int(255 * (1 - strength)))
    return ImageChops.multiply(img, shade.convert("RGB"))


def bezel(img):
    """The frame: a dim magenta hairline plus two bright corner brackets.

    Same motif as `.panel::before` / `.panel::after` in the stylesheet — top-left
    and bottom-right only, never all four. Three pixels per arm is what reads as
    a bracket at this size; two reads as a stray pixel.
    """
    draw = ImageDraw.Draw(img)
    dim = tuple(round(m * 0.62 + v * 0.38) for m, v in zip(MAGENTA, VOID))
    draw.rectangle([0, 0, W - 1, H - 1], outline=dim)

    arm = 3
    draw.line([(0, 0), (arm, 0)], fill=MAGENTA)
    draw.line([(0, 0), (0, arm)], fill=MAGENTA)
    draw.line([(W - 1 - arm, H - 1), (W - 1, H - 1)], fill=MAGENTA)
    draw.line([(W - 1, H - 1 - arm), (W - 1, H - 1)], fill=MAGENTA)
    return img


def lit_screen(top=PANEL, bottom=VOID, bloom=VIOLET, bloom_strength=0.30):
    """A backdrop that looks like a powered tube rather than a filled rectangle.

    Same idea as the favicon's radial gradient: brightest a little above centre,
    falling off to the page void at the bezel. Costs a handful of palette
    entries and is most of why these don't look like flat swatches.
    """
    img = Image.new("RGB", (W, H))
    pixels = img.load()
    for y in range(H):
        t = y / (H - 1)
        row = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
        for x in range(W):
            # Squared falloff from the hot spot, normalised so the corners land
            # at zero — a linear falloff leaves a visible disc edge.
            dx = (x - W / 2) / (W / 2)
            dy = (y - H * 0.42) / (H * 0.7)
            fall = max(0.0, 1.0 - (dx * dx + dy * dy))
            k = bloom_strength * fall * fall
            pixels[x, y] = tuple(round(c + (b - c) * k) for c, b in zip(row, bloom))
    return img


# --- the hero: kana rain -----------------------------------------------------
#
# Everything about the animation is a pure function of the frame index, which is
# what makes the loop seamless: frame 24 would be identical to frame 0, so there
# is no seam to land on. Get this wrong and the rain visibly restarts, which on a
# 1.7s loop in someone's sidebar is all anyone will see.

FRAMES = 24
COL_PITCH = 5   # half-width kana advance 4.5px, rounded up so columns don't touch
ROW_PITCH = 7   # kana ink is 8px tall; 7 lets rows kiss, which reads as a stream
TRAIL = 4       # rows lit behind the head, including it
COLS = (W - 2) // COL_PITCH   # 17
ROWS = (H - 2) // ROW_PITCH   # 4 — floor, so no row is half-eaten by the bezel
SPAN = ROWS + TRAIL           # rows a head travels: off the top, then off the bottom

# One row per frame, for every column. The variation between columns is *where
# each drop starts*, not how fast it falls — see rain_columns.
#
# An earlier version gave columns two different speeds and it was the wrong
# instrument: rain doesn't fall at assorted rates in the same downpour, and mixed
# speeds read less like depth than like some columns lagging. Stagger the phases
# and every column falls together while no two are ever in the same place, which
# is the effect the mixed speeds were reaching for. Fall speed is now set once,
# by the frame duration in main.
FALL = 1

# The seam check, and the reason the constants above are what they are.
#
# A column is back where it started after SPAN * FALL frames. If that doesn't
# divide FRAMES, the GIF's last frame doesn't hand over to its first, and the
# rain visibly restarts once every loop — which, in the corner of someone's
# sidebar, is the only thing anyone would notice about it. This caught a real
# one: ROW_PITCH 7 over 29px rounds *up* to 5 rows if you let it, and SPAN 9
# divides neither 24 nor anything else convenient.
assert FRAMES % (SPAN * FALL) == 0, (
    f"a drop loops every {SPAN * FALL} frames, which doesn't divide {FRAMES}"
)

# The trail, head first. Not a mathematical fade — the head is deliberately
# almost white so it reads as the lit character, and the falloff is steep enough
# that four rows feel like a tail rather than a gradient.
TRAIL_COLORS = [
    (0xF2, 0xE4, 0xFF),
    (0xB1, 0x7C, 0xF5),
    (0x7C, 0x3A, 0xED),
    (0x43, 0x1C, 0x82),
]


def rain_columns(seed=0x53C7):
    """Each column's starting phase — how far into its fall it is at frame zero.

    Dealt rather than rolled. Seventeen columns over eight phases are laid out as
    `i % SPAN` and then shuffled, so every phase is used at least twice and the
    heads are spread evenly down the button. Drawing seventeen independent random
    phases instead leaves gaps and clusters: with eight buckets and seventeen
    draws you routinely get a phase nobody picked and another picked five times,
    and four of the columns then fall in lockstep, which is visible as a bright
    horizontal rank moving down the button — the exact wipe the stagger exists to
    prevent.

    Fixed seed, and the phases are baked in here rather than re-derived per frame,
    because a column has to keep its place in the loop for the whole loop.
    """
    phases = [i % SPAN for i in range(COLS)]
    random.Random(seed).shuffle(phases)
    return phases


def rain_glyph(col, row, frame):
    """Which kana is at this cell on this frame.

    Hashed rather than sequenced so it needs no state, and keyed on a frame
    counter divided by three, so a glyph holds for three frames before
    re-rolling. Re-rolling every frame is a strobe, not rain; never re-rolling
    makes the trail look like it's sliding a fixed string down the screen.

    The `+ col` is what keeps the re-rolls from happening everywhere at once.
    Now that every column falls in step, a re-roll keyed on the frame alone
    changes all seventeen columns on the same frame, and seventeen simultaneous
    glyph swaps read as the whole button blinking rather than as characters
    turning over. Offsetting by the column staggers the swaps across three
    frames instead.

    Mixed by hand rather than with `hash()`: the builtin's value for a tuple is
    an implementation detail, and this file's whole claim to byte-identical
    rebuilds rests on the arithmetic here being the same next year.
    """
    h = (col * 0x9E3779B1) ^ (row * 0x85EBCA77) ^ (((frame + col) // 3) * 0xC2B2AE3D)
    h = (h ^ (h >> 15)) * 0x2545F491 & 0xFFFFFFFF
    return GLYPHS[(h >> 11) % len(GLYPHS)]


def hero_frames():
    columns = rain_columns()
    backdrop = lit_screen()

    # Every glyph the rain can draw, rasterised once. Seventeen columns times
    # four rows times 24 frames is over 1600 lookups of a 25-glyph alphabet;
    # rasterising each one on demand would dominate the runtime for no reason.
    masks = {g: ink(g, KANA) for g in GLYPHS}

    title = ink("sp3ctr-zone", TITLE)
    title_xy = centered(title, (1, 1, W - 2, H - 2))

    # Where the rain gets knocked back so magenta-on-violet stays readable.
    #
    # This is the letters' own shape, fattened and softened — not a horizontal
    # band across the button. The band was the first attempt and it was a
    # mistake: it darkened two of the four rain rows edge to edge, so the rain
    # only ever showed along the top and bottom and the whole thing looked
    # half-empty. Shaped like the wordmark, the rain keeps falling *between* the
    # letters and through the counters of the 'o' and 'e', which is both denser
    # and much more convincing — the text reads as lit from behind the stream
    # rather than pasted over a gap in it.
    #
    # MaxFilter(5) dilates by two pixels before the blur softens the result, which
    # is what opens a moat around each letter rather than a tight outline. Three
    # was not enough: a bright head landing in the gap between 'r' and '-' sat
    # right against the stroke at full brightness and the wordmark started to
    # come apart. Two pixels of dark either side is the whole difference.
    veil = Image.new("L", (W, H), 0)
    veil.paste(title, title_xy)
    veil = veil.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.4))

    # Weight per pixel for judging the still: positive everywhere the wordmark
    # isn't, negative and three times as loud where it is. See pick_still.
    clear = veil.point(lambda v: 255 - v)

    frames, stillness = [], []
    for frame in range(FRAMES):
        img = backdrop.copy()

        # Drawn onto black and screened on, so overlapping trails add light
        # instead of the later column painting over the earlier one.
        streaks = Image.new("RGB", (W, H))
        for col, phase in enumerate(columns):
            head = (frame // FALL + phase) % SPAN - TRAIL
            for depth, color in enumerate(TRAIL_COLORS):
                row = head - depth
                if not 0 <= row < ROWS:
                    continue
                glyph = masks[rain_glyph(col, row, frame)]
                stamp(streaks, glyph, (1 + col * COL_PITCH, 1 + row * ROW_PITCH), color)

        # Scored here, on the rain by itself, and this is the only moment it can
        # be: once the wordmark is stamped on top there is no telling its pixels
        # from a kana's. Measuring the finished frame instead was the first
        # attempt and it silently didn't work — the letters and their glow are
        # ~180 lit pixels inside the veil on every single frame, so the 20-pixel
        # rain signal underneath never moved the total and the "best" frame came
        # out essentially at random.
        lit = streaks.convert("L").point(lambda v: 255 if v > 60 else 0)
        stillness.append(sum(ImageChops.multiply(lit, clear).getdata())
                         - 3 * sum(ImageChops.multiply(lit, veil).getdata()))

        img = ImageChops.screen(img, streaks)

        img = Image.composite(ImageChops.multiply(img, Image.new("RGB", (W, H), (58, 40, 74))),
                              img, veil)

        img = glow(img, title, title_xy, MAGENTA, radius=1.7, strength=0.9)
        stamp(img, title, title_xy, MAGENTA)

        frames.append(bezel(screen_lines(img)))

    return frames, stillness


# --- the badges --------------------------------------------------------------

# Icons are filled silhouettes, not outlines. This was the lesson of the first
# pass: at eleven pixels a one-pixel outline of a padlock is a grey smudge with a
# hole in it, and the eye that was meant to say "verify" read as a bean. Mass
# survives the size; contour doesn't. The one exception is </>, which has to be
# strokes because that's what the glyphs are.
BADGES = [
    {
        # A lens, not a tick. "Trust but verify" is an instruction to go and look
        # at the thing, and a checkmark says the opposite — that someone already
        # looked for you.
        "name": "trust-but-verify",
        "lines": ("TRUST BUT", "VERIFY"),
        "icon": """
        .#####...
        ##...##..
        #.....#..
        #.....#..
        #.....#..
        ##...##..
        .#####...
        ...##.##.
        ....#.###
        .....###.
        ......##.
        """,
    },
    {
        "name": "view-source",
        "lines": ("VIEW", "SOURCE"),
        "icon": """
        ...#...#.#...
        ..#....#..#..
        ..#...#...#..
        .#....#....#.
        #.....#.....#
        .#...#.....#.
        ..#..#....#..
        ..#..#....#..
        ...#.#...#...
        """,
    },
    {
        "name": "encrypt-everything",
        "lines": ("ENCRYPT", "EVERYTHING"),
        "icon": """
        ..#####..
        .##...##.
        .#.....#.
        #########
        #########
        ###...###
        ###...###
        ####.####
        #########
        """,
    },
    {
        "name": "no-ai-training",
        "lines": ("NO AI", "TRAINING"),
        "icon": """
        ..#####..
        .##...###
        ##...##.#
        ##..##..#
        #..##...#
        #.##...##
        ###...##.
        .#####...
        """,
    },
    {
        # Nodes, because the footer of every page on this site says
        # "NODE: sp3ctr-zone" — the reason they can't stop us all is that there
        # is no single one of us to stop.
        #
        # Two earlier drafts failed for the same reason. Interlocking rings with
        # a gap read as an infinity sign, which says the opposite thing; a proper
        # mesh with corner nodes wired to a hub read as a bare X, because at this
        # size a one-pixel diagonal is the loudest thing in the sprite and the
        # nodes it connects vanish behind it. So: no edges at all. Nine solid
        # blocks say "many, and no centre" on their own, and they stay crisp.
        "name": "they-cant-stop-us-all",
        "lines": ("CAN'T STOP", "US ALL"),
        "icon": """
        ###.###.###
        ###.###.###
        ###.###.###
        ...........
        ###.###.###
        ###.###.###
        ###.###.###
        ...........
        ###.###.###
        ###.###.###
        ###.###.###
        """,
    },
]

# The interior, minus a pixel of air inside the bezel: a 13px icon well on the
# left, a hairline rule, then a 64px text column.
#
# Every line in BADGES is measured to fit inside 60px at this font size. That is
# not slack to be spent — the first draft ran "STOP US ALL" (66px) edge to edge
# and the glow bled straight into the bezel, which is why that badge now reads
# "CAN'T STOP / US ALL".
#
# The three columns between the widest icon (</>, 13px, so x 2..14) and the rule
# are for the icon's glow to land in. ICON_CLEARANCE below is what holds anyone —
# including a later me — to that.
ICON_BOX = (2, 1, 13, H - 2)
RULE_X = 18
TEXT_BOX = (21, 1, 64, H - 2)
ICON_CLEARANCE = 3


def badge(spec):
    img = lit_screen(bloom_strength=0.22)

    icon = sprite(spec["icon"])
    icon_xy = centered(icon, ICON_BOX)

    # The check that would have caught the missing dedent immediately, instead of
    # five badges shipping with their icons jammed against the rule. It fires on
    # an oversized sprite and on a mis-measured layout alike, which are the only
    # two ways an icon can get over there.
    assert icon_xy[0] + icon.width + ICON_CLEARANCE <= RULE_X, (
        f"{spec['name']}: a {icon.width}px icon at x={icon_xy[0]} leaves "
        f"{RULE_X - icon_xy[0] - icon.width}px before the rule, want {ICON_CLEARANCE}"
    )
    assert icon_xy[0] >= 1, f"{spec['name']}: icon starts at x={icon_xy[0]}, inside the bezel"

    img = glow(img, icon, icon_xy, VIOLET, radius=1.0, strength=0.5)
    stamp(img, icon, icon_xy, ASH)

    # The rule earns its pixel: without it the icon and the first word read as
    # one ragged left edge, and the badge loses the split-panel look that says
    # "88x31 button" more than anything else about it does.
    ImageDraw.Draw(img).line([(RULE_X, 4), (RULE_X, H - 5)], fill=MAUVE)

    top, bottom = (ink(line, BADGE) for line in spec["lines"])
    # 7px caps, 3px gutter, both lines centred as a block in the text column —
    # so a two-word badge and a one-word badge sit on the same baselines.
    block_top = TEXT_BOX[1] + (TEXT_BOX[3] - (top.height + 3 + bottom.height)) // 2
    for line, y in ((top, block_top), (bottom, block_top + top.height + 3)):
        xy = (centered(line, TEXT_BOX)[0], y)
        # Barely any glow, and much tighter than the wordmark's. The hero can
        # afford a halo because its letters are magenta on near-black; here they
        # are pale ash, so a wide magenta bloom doesn't read as light coming off
        # the text, it reads as the text being out of focus. Radius 1.5 at
        # strength 0.55 filled the counters of the 'e' and the gap in "NO AI".
        img = glow(img, line, xy, MAGENTA, radius=0.9, strength=0.3)
        stamp(img, line, xy, ASH)

    return bezel(screen_lines(img))


# --- writing GIFs ------------------------------------------------------------


def quantize(frames, colors=64):
    """One palette for every frame, derived from all of them at once.

    Quantising each frame independently gives each its own palette, and the
    button then shimmers as the browser swaps between them — the rain's own
    animation is hard enough to keep clean without the colours moving too.
    Dithering is off throughout: at 88x31 a dither pattern is not a texture,
    it's noise, and it costs a lot of GIF bytes to store.
    """
    reference = Image.new("RGB", (W, H * len(frames)))
    for i, frame in enumerate(frames):
        reference.paste(frame, (0, i * H))
    palette = reference.quantize(colors=colors, method=Image.Quantize.MEDIANCUT,
                                 dither=Image.Dither.NONE)
    return [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]


def write(name, frames, duration=None):
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{name}.gif"
    quantized = quantize(frames)
    # A still has no duration and no loop to declare; passing either writes a
    # Netscape looping block into a one-frame GIF, which Pillow won't even
    # encode. Animated buttons get both, and loop=0 means forever.
    timing = {"duration": duration, "loop": 0} if duration else {}
    quantized[0].save(
        path,
        save_all=True,
        append_images=quantized[1:],
        optimize=True,
        disposal=1,
        **timing,
    )
    print(f"  {path.relative_to(OUT.parent)}  {path.stat().st_size / 1024:.1f} KB"
          f"  {len(frames)} frame{'s' if len(frames) != 1 else ''}")


def pick_still(frames, stillness):
    """The frame that makes the best single picture of the animation.

    Not the brightest one. Ranking frames by how much rain they contain picks
    whichever frame has the most kana sitting on top of the wordmark, which is
    the one frame nobody would choose by eye.

    So `stillness` — scored back in hero_frames, where the rain can still be
    told apart from the lettering — rewards rain that falls clear of the letters
    and penalises rain across them three times as hard. Wanting both directions
    is the point: rain away from the text is what makes a still look like the
    animation it came from, and rain over the text is the only thing that makes
    it hard to read.
    """
    return max(zip(stillness, frames), key=lambda pair: pair[0])[1]


def main():
    print("88x31 foundry")
    animation, stillness = hero_frames()

    # Frame duration is the fall-speed control now that FALL is fixed at one row
    # per frame — every frame moves the rain, so there is no stepping to hide, and
    # this is just how fast a row goes by. 100ms puts a drop's whole descent at
    # 800ms and the loop at 2.4s.
    write("sp3ctr-zone", animation, duration=100)

    # The still is not a spare. prefers-reduced-motion is honoured everywhere
    # else on this site — the boot flash, the static, the ticker, the scrambler
    # all stand down — and it would be strange for the one file a visitor is
    # invited to copy onto their own page to be the one thing that ignores it.
    write("sp3ctr-zone-static", [pick_still(animation, stillness)])

    for spec in BADGES:
        write(spec["name"], [badge(spec)])


if __name__ == "__main__":
    main()
