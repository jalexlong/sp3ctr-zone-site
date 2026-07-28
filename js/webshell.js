// sp3ctr-zone :: webshell
//
// a fake Debian shell that runs entirely in your browser. there is no server,
// no real filesystem, and nothing here executes anything — the whole "machine"
// is the HOME object below. add files to it and they show up in the shell.
//
// the session is confined to /home/guest the way a chroot would confine it:
// any path that resolves outside HOME_PATH is refused with ACCESS_DENIED.

const HOST = "sp3ctr-zone";
const USER = "guest";
const HOME_PATH = "/home/guest";

// ---------------------------------------------------------------------------
// the filesystem. dirs have `children`, files have `content`.
// drop new entries in here — that's the whole extension mechanism.
// ---------------------------------------------------------------------------
const HOME = {
  type: "dir",
  children: {
    "README.txt": {
      type: "file",
      content: "Hello, world!\n",
    },
    ".bashrc": {
      type: "file",
      content: [
        "# ~/.bashrc — guest session",
        "export PS1='\\u@\\h:\\w\\$ '",
        "export HISTFILE=/dev/null   # nothing you type here is kept",
        "alias ll='ls -la'",
        "",
      ].join("\n"),
    },
    ".profile": {
      type: "file",
      content: "# sourced at login. nothing to see here.\n",
    },
    "links.txt": {
      type: "file",
      content: [
        "elsewhere on this node:",
        "",
        "  /transmissions/   sealed entries, open one to decrypt it",
        "  /tools/           client-side cipher toolkit",
        "  /about/           who runs this thing",
        "",
      ].join("\n"),
    },
    notes: {
      type: "dir",
      children: {
        "handshake.txt": {
          type: "file",
          content: [
            "if you found this, you already know how to look.",
            "",
            "the useful habit isn't knowing secrets, it's checking claims.",
            "read the source. verify the signature. run the numbers.",
            "",
          ].join("\n"),
        },
        "reading-list.txt": {
          type: "file",
          content: [
            "- the underground handbook, chapter 0: don't trust, verify",
            "- anything that ships its source alongside its binary",
            "- your own logs, occasionally",
            "",
          ].join("\n"),
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// boot sequence. `ok: true` renders the systemd-style green-slot bracket.
// ---------------------------------------------------------------------------
const BOOT_LINES = [
  { text: "[    0.000000] Linux version 6.1.0-27-amd64 (gcc-12 12.2.0) #1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1" },
  { text: "[    0.000000] Command line: BOOT_IMAGE=/vmlinuz root=/dev/sda1 ro quiet" },
  { text: "[    0.004112] BIOS-provided physical RAM map:" },
  { text: "[    0.021447] Memory: 2048MB available" },
  { text: "[    0.098331] Detected CRT phosphor persistence, enabling scanline compensation" },
  { text: "[    0.143902] loop: module loaded" },
  { text: "[    0.287610] sd 0:0:0:0: [sda] Attached SCSI disk" },
  { text: "[    0.512004] EXT4-fs (sda1): mounted filesystem with ordered data mode" },
  { text: "[    0.664219] random: crng init done", pause: 260 },
  { text: "Starting version 252.30-1~deb12u2", dim: true },
  { text: "Mounted /home.", ok: true },
  { text: "Reached target Local File Systems.", ok: true },
  { text: "Started Journal Service.", ok: true },
  { text: "Started Network Time Synchronization.", ok: true },
  { text: "Started Regular background program processing daemon.", ok: true },
  { text: "Started sp3ctr-zone transmission relay.", ok: true },
  { text: "Started OpenBSD Secure Shell server.", ok: true },
  { text: "Reached target Multi-User System.", ok: true, pause: 320 },
  { text: "Started Getty on tty1.", ok: true, pause: 420 },
  { text: "" },
  { text: `Debian GNU/Linux 12 ${HOST} tty1` },
  { text: "" },
  { text: `${HOST} login: ${USER} (automatic login)`, pause: 500 },
  { text: "" },
];

const MOTD = [
  `Linux ${HOST} 6.1.0-27-amd64 #1 SMP Debian x86_64`,
  "",
  "The programs included with the Debian GNU/Linux system are free software;",
  "the exact distribution terms for each program are described in the",
  "individual files in /usr/share/doc/*/copyright.",
  "",
  "Debian GNU/Linux comes with ABSOLUTELY NO WARRANTY, to the extent",
  "permitted by applicable law.",
  "",
  "  guest session — confined to /home/guest. no network, no persistence.",
  "  type `help` for available commands, `ls` to look around.",
  "",
];

// ---------------------------------------------------------------------------
// path handling
// ---------------------------------------------------------------------------

// Turn any user-typed path into an absolute, normalized one.
function resolvePath(input, cwd) {
  let path = input;
  if (path === "~" || path.startsWith("~/")) path = HOME_PATH + path.slice(1);

  const segments = path.startsWith("/") ? [] : cwd.split("/").filter(Boolean);
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return "/" + segments.join("/");
}

// The chroot check: everything must live at or under HOME_PATH.
function insideJail(path) {
  return path === HOME_PATH || path.startsWith(HOME_PATH + "/");
}

// Walk the HOME tree to whatever node `path` names, or null if nothing's there.
function lookup(path) {
  const parts = path.slice(HOME_PATH.length).split("/").filter(Boolean);
  let node = HOME;
  for (const part of parts) {
    if (node.type !== "dir" || !node.children[part]) return null;
    node = node.children[part];
  }
  return node;
}

// ~ for home, ~/notes for anything under it — what the prompt displays.
function shortenPath(path) {
  return path === HOME_PATH ? "~" : "~" + path.slice(HOME_PATH.length);
}

function promptText(cwd) {
  return `${USER}@${HOST}:${shortenPath(cwd)}$`;
}

// ---------------------------------------------------------------------------
// terminal output
// ---------------------------------------------------------------------------
const screen = document.querySelector("#shell");
const output = document.querySelector("#shell-output");
const form = document.querySelector("#shell-form");
const input = document.querySelector("#shell-input");
const promptEl = document.querySelector("#shell-prompt");

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Every line goes through here. Text is set with textContent, never innerHTML,
// so file contents can't inject markup into the page.
function print(text = "", options = {}) {
  const line = document.createElement("div");
  line.className = "shell-line";
  if (options.dim) line.classList.add("shell-dim");
  if (options.error) line.classList.add("shell-err");

  if (options.ok) {
    const badge = document.createElement("span");
    badge.className = "shell-ok";
    badge.textContent = "[  OK  ] ";
    line.append(badge, document.createTextNode(text));
  } else {
    line.textContent = text;
  }

  output.append(line);
  screen.scrollTop = screen.scrollHeight;
}

function printLines(lines, options) {
  lines.forEach((line) => print(line, options));
}

// ---------------------------------------------------------------------------
// commands. each gets (args, session) and prints whatever it wants.
// ---------------------------------------------------------------------------
const session = { cwd: HOME_PATH, history: [] };

function denied(path) {
  print(`ACCESS_DENIED: ${path}`, { error: true });
  print(`bash: location forbidden — this session is confined to ${HOME_PATH}`, { dim: true });
}

// Resolve a path argument, printing the right error and returning null on failure.
function openPath(arg, { expect } = {}) {
  const path = resolvePath(arg, session.cwd);

  if (!insideJail(path)) {
    denied(path);
    return null;
  }

  const node = lookup(path);
  if (!node) {
    print(`bash: ${arg}: No such file or directory`, { error: true });
    return null;
  }
  if (expect && node.type !== expect) {
    const problem = expect === "dir" ? "Not a directory" : "Is a directory";
    print(`bash: ${arg}: ${problem}`, { error: true });
    return null;
  }
  return { path, node };
}

function listing(node, { all = false } = {}) {
  const names = Object.keys(node.children).sort();
  return all ? [".", "..", ...names] : names.filter((name) => !name.startsWith("."));
}

const COMMANDS = {
  help() {
    print("available commands:");
    print("");
    const rows = [
      ["ls [-a] [-l] [path]", "list directory contents"],
      ["cd [path]", "change directory"],
      ["pwd", "print working directory"],
      ["cat <file>", "print a file"],
      ["tree", "show the directory tree"],
      ["echo <text>", "print text"],
      ["whoami / id", "current user"],
      ["hostname / uname [-a]", "system info"],
      ["date / uptime", "clock and session length"],
      ["history", "commands typed this session"],
      ["clear", "clear the screen"],
      ["exit", "end the session"],
    ];
    rows.forEach(([name, description]) => {
      print(`  ${name.padEnd(24)}${description}`);
    });
    print("");
  },

  ls(args) {
    const flags = args.filter((arg) => arg.startsWith("-")).join("");
    const targets = args.filter((arg) => !arg.startsWith("-"));
    const found = openPath(targets[0] ?? ".");
    if (!found) return;

    if (found.node.type === "file") {
      print(targets[0]);
      return;
    }

    const names = listing(found.node, { all: flags.includes("a") });
    if (!names.length) return;

    if (flags.includes("l")) {
      names.forEach((name) => {
        const child = name === "." ? found.node : name === ".." ? found.node : found.node.children[name];
        const isDir = child.type === "dir";
        const mode = isDir ? "drwxr-xr-x" : "-rw-r--r--";
        const size = isDir ? 4096 : child.content.length;
        print(`${mode}  1 ${USER} ${USER} ${String(size).padStart(6)} Jul 26 21:03 ${name}`);
      });
    } else {
      print(names.join("  "));
    }
  },

  cd(args) {
    if (!args.length) {
      session.cwd = HOME_PATH;
      return;
    }
    const found = openPath(args[0], { expect: "dir" });
    if (found) session.cwd = found.path;
  },

  pwd() {
    print(session.cwd);
  },

  cat(args) {
    if (!args.length) {
      print("usage: cat <file>", { dim: true });
      return;
    }
    args.forEach((arg) => {
      const found = openPath(arg, { expect: "file" });
      if (found) found.node.content.replace(/\n$/, "").split("\n").forEach((line) => print(line));
    });
  },

  tree() {
    print(shortenPath(session.cwd));
    const found = lookup(session.cwd);

    const walk = (node, prefix) => {
      const names = listing(node);
      names.forEach((name, index) => {
        const last = index === names.length - 1;
        const child = node.children[name];
        print(`${prefix}${last ? "└── " : "├── "}${name}`);
        if (child.type === "dir") walk(child, prefix + (last ? "    " : "│   "));
      });
    };

    walk(found, "");
  },

  echo(args) {
    print(args.join(" "));
  },

  whoami() {
    print(USER);
  },

  id() {
    print(`uid=1000(${USER}) gid=1000(${USER}) groups=1000(${USER})`);
  },

  hostname() {
    print(HOST);
  },

  uname(args) {
    const all = args.includes("-a");
    print(all ? `Linux ${HOST} 6.1.0-27-amd64 #1 SMP Debian 6.1.115-1 x86_64 GNU/Linux` : "Linux");
  },

  date() {
    print(new Date().toString());
  },

  uptime() {
    const seconds = Math.floor((Date.now() - session.startedAt) / 1000);
    const minutes = Math.floor(seconds / 60);
    print(` ${new Date().toTimeString().slice(0, 8)} up ${minutes} min,  1 user,  load average: 0.00, 0.01, 0.05`);
  },

  history() {
    session.history.forEach((entry, index) => {
      print(`${String(index + 1).padStart(5)}  ${entry}`);
    });
  },

  clear() {
    output.replaceChildren();
  },

  sudo() {
    print(`${USER} is not in the sudoers file.  This incident has been reported.`, { error: true });
  },

  exit() {
    print("logout", { dim: true });
    print("");
    print("connection to sp3ctr-zone closed. refresh to reconnect.", { dim: true });
    form.hidden = true;
  },
};

// Everything that would write to disk gets the same honest refusal.
["mkdir", "rm", "touch", "mv", "cp", "chmod"].forEach((name) => {
  COMMANDS[name] = () => {
    print(`${name}: cannot modify '${shortenPath(session.cwd)}': Read-only file system`, { error: true });
  };
});

COMMANDS.ll = (args) => COMMANDS.ls(["-la", ...args]);
COMMANDS.man = () => print("What manual page do you want?  (try `help`)", { dim: true });

// ---------------------------------------------------------------------------
// the read-eval-print loop
// ---------------------------------------------------------------------------
function run(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  session.history.push(trimmed);

  const [name, ...args] = trimmed.split(/\s+/);
  const command = COMMANDS[name];

  if (command) command(args, session);
  else print(`bash: ${name}: command not found`, { error: true });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const line = input.value;

  print(`${promptText(session.cwd)} ${line}`);
  input.value = "";
  historyCursor = null;

  run(line);

  promptEl.textContent = promptText(session.cwd);
  screen.scrollTop = screen.scrollHeight;
});

// Arrow keys walk back through history; Tab completes commands and filenames.
let historyCursor = null;

input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    if (!session.history.length) return;
    event.preventDefault();

    if (event.key === "ArrowUp") {
      historyCursor = historyCursor === null ? session.history.length - 1 : Math.max(0, historyCursor - 1);
    } else if (historyCursor !== null) {
      historyCursor += 1;
      if (historyCursor >= session.history.length) {
        historyCursor = null;
        input.value = "";
        return;
      }
    }
    input.value = session.history[historyCursor] ?? "";
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    const parts = input.value.split(/\s+/);
    const partial = parts[parts.length - 1] ?? "";

    const pool =
      parts.length <= 1
        ? Object.keys(COMMANDS)
        : listing(lookup(session.cwd) ?? HOME, { all: partial.startsWith(".") });

    const matches = pool.filter((name) => name.startsWith(partial)).sort();
    if (matches.length === 1) {
      parts[parts.length - 1] = matches[0];
      input.value = parts.join(" ");
    } else if (matches.length > 1) {
      print(`${promptText(session.cwd)} ${input.value}`);
      print(matches.join("  "));
    }
  }
});

// Clicking anywhere on the screen focuses the prompt, like a real terminal.
screen.addEventListener("click", () => {
  if (!form.hidden && !window.getSelection().toString()) input.focus();
});

// ---------------------------------------------------------------------------
// boot, then hand the session over
// ---------------------------------------------------------------------------
function startSession() {
  printLines(MOTD);
  session.startedAt = Date.now();
  promptEl.textContent = promptText(session.cwd);
  form.hidden = false;
  input.focus({ preventScroll: true });
}

function boot() {
  if (reducedMotion) {
    BOOT_LINES.forEach((line) => print(line.text, line));
    startSession();
    return;
  }

  let index = 0;
  const step = () => {
    if (index >= BOOT_LINES.length) {
      startSession();
      return;
    }
    const line = BOOT_LINES[index++];
    print(line.text, line);
    setTimeout(step, line.pause ?? 55);
  };
  step();
}

boot();
