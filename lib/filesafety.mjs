// The file fail-safes: rules about paths that hold in every permission mode, even "everything, read & change".
// Pure checks (no settings of their own); permissions.mjs and abilities.mjs call them.
//   pathTrick(input)       → a reason string when the path uses a trick (.., UNC, \\?\, 8.3 short names, trailing dots or
//                            spaces, alternate data streams, device names), else null
//   realPath(full)         → the real location on disk, with symlinks and junctions followed (the part that exists is
//                            resolved, the rest is added back), so a link can't be used to escape
//   hardBlock(full, opts)  → { reason, text } when nothing may change or delete it (Windows, Program Files, boot files,
//                            registry hives, drive-root files, other people's profiles, Dayspring's own code and data,
//                            its permissions and logs, .git internals, secrets), else null
//   isSecretPath(full)     → passwords, keys, wallets (never opened, never changed)
//   importance(full, op, opts) → plain-language reasons a change is allowed but risky ("It's your hosts file…"); [] when fine
//   countFiles(dir, cap)   → how many files a folder holds (for bulk confirmations)
import { existsSync, realpathSync, readdirSync, statSync, lstatSync } from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { isSecret } from "./files.mjs";

export const DESK = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
// the Dayspring project: the app is at its root, or in apps/desk of a monorepo checkout (then the whole repo is its code)
export const PROJECT = basename(DESK).toLowerCase() === "desk" && basename(dirname(DESK)).toLowerCase() === "apps" ? resolve(DESK, "..", "..") : DESK;

export const SECRET_DIR = /(^|[\\/])(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.config[\\/]gh|1password|bitwarden|keepass|wallets?|electrum|exodus|metamask)([\\/]|$)/i;
export const SECRET_NAME = /(password|passwd|wallet|seed[-_ ]?phrase|recovery[-_ ]?(codes?|phrase)|private[-_ ]?key|\.kdbx$|login data|cookies$)/i;
export const isSecretPath = (full) => isSecret(full) || SECRET_DIR.test(full) || SECRET_NAME.test(basename(full));

const lc = (p) => String(p).toLowerCase().replace(/[\\/]+$/, "");
// is p the folder root itself, or inside it? (case-insensitive, whole path parts only)
export function under(p, root) {
  if (!root) return false;
  const a = lc(resolve(p)), b = lc(resolve(root));
  return a === b || a.startsWith(b.endsWith(":") ? b + "\\" : b + "\\");
}
const isDriveRoot = (p) => /^[a-z]:\\?$/i.test(String(p));

// ---- path tricks ------------------------------------------------------------------------------------------------------
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
export function pathTrick(input) {
  const s = String(input ?? "");
  if (/\0/.test(s)) return "It has a hidden character in it.";
  if (/^[\\/]{2}[?.][\\/]/.test(s) || /^\\\?\?\\/.test(s)) return "It uses a special Windows path form (\\\\?\\ or \\\\.\\) that skips the normal safety checks.";
  if (/^[\\/]{2}[^\\/]/.test(s)) return "It points to another computer on the network (a \\\\server\\share path).";
  const body = s.replace(/^[a-z]:/i, "");
  if (body.includes(":")) return "It names a hidden part of a file (an alternate data stream).";
  const parts = s.split(/[\\/]+/).filter(Boolean);
  for (const [i, part] of parts.entries()) {
    if (i === 0 && /^[a-z]:$/i.test(part)) continue;
    if (part === "..") return "It uses \"..\" to step out of a folder.";
    if (part !== "." && /[. ]$/.test(part)) return "A name ends in a dot or a space, which Windows quietly drops (so it could mean a different file).";
    if (/~\d/.test(part)) return "It uses a short 8.3 name (like PROGRA~1), which can hide the real folder.";
    if (DEVICE.test(part)) return "It uses a reserved Windows device name (like CON or NUL).";
  }
  return null;
}

// ---- where it really is ----------------------------------------------------------------------------------------------
// The deepest part that exists is resolved by Windows (symlinks, junctions, short names, mapped drives); the rest is added.
export function realPath(full) {
  let cur = resolve(full);
  const rest = [];
  for (let i = 0; i < 80; i++) {
    let st = null;
    try { st = lstatSync(cur); } catch { /* doesn't exist (yet) */ }
    if (st) {
      let real;
      try { real = realpathSync.native(cur); } catch { real = cur; }
      // a link whose target is gone: follow what it says, so it can't point somewhere protected
      return rest.length ? join(real, ...rest.reverse()) : real;
    }
    const up = dirname(cur);
    if (up === cur) break;
    rest.push(basename(cur));
    cur = up;
  }
  return resolve(full);
}
// Windows gives back \\?\UNC\… or a mapped drive's \\server\… for network places; either is a network path
export const isNetworkPath = (p) => /^[\\/]{2}/.test(String(p));

// ---- the hard blocks -------------------------------------------------------------------------------------------------
const env = (k) => process.env[k] || "";
function systemPlaces() {
  const drive = (env("SystemDrive") || "C:").replace(/[\\/]+$/, "");
  const win = env("SystemRoot") || env("windir") || `${drive}\\Windows`;
  const pd = env("ProgramData") || `${drive}\\ProgramData`;
  const pf = [env("ProgramFiles"), env("ProgramFiles(x86)"), env("ProgramW6432"), `${drive}\\Program Files`, `${drive}\\Program Files (x86)`].filter(Boolean);
  const pdSystem = ["Microsoft", "Packages", "Package Cache", "regid.1991-06.com.microsoft", "ssh", "USOPrivate", "USOShared", "WindowsHolographicDevices", "Windows Defender", "Microsoft OneDrive"].map((x) => join(pd, x));
  return { drive, win, pd, pf, pdSystem, users: `${drive}\\Users` };
}
// at the top of any drive: boot, recovery and Windows' own folders
const ROOT_SYSTEM = /^(boot|recovery|efi|\$recycle\.bin|system volume information|\$winreagent|\$windows\.~bt|\$windows\.~ws|\$sysreset|\$getcurrent|config\.msi|documents and settings|perflogs|msocache|\$windows\.old|windows\.old)$/i;
const HIVE = /^(ntuser|usrclass)\.(dat|ini|pol)/i;
const BOOTFILE = /^(bootmgr|bootnxt|bootsect\.bak|pagefile\.sys|hiberfil\.sys|swapfile\.sys|dumpstack\.log(\.tmp)?|ntldr|ntdetect\.com|boot\.ini|io\.sys|msdos\.sys)$/i;
const NOT_PEOPLE = /^(default|default user|all users|defaultapppool|wdagutilityaccount)$/i;

const block = (reason, text) => ({ reason, text });
// opts: { protect: [folders Dayspring guards: its code, data, logs, backups, permission file], allow: [folders inside those
//        it may still write, like the notes folder], ownPlaces: [places that belong to the owner, so their profile is theirs],
//        kind: "file" | "folder" (for something that doesn't exist yet) }
export function hardBlock(full, opts = {}) {
  const f = resolve(full), name = basename(f);
  const S = systemPlaces();
  if (isNetworkPath(f)) return block("network", "That's on another computer on the network, so I won't change it.");
  if (isDriveRoot(f)) return block("drive", "That's a whole drive, so I won't change it.");
  if (isSecretPath(f)) return block("secret", "That file looks like it holds passwords or keys, so I won't touch it.");
  if (under(f, S.win)) return block("windows", "That's part of Windows itself (like System32), so I won't change or delete it. Changing it could stop the computer from starting.");
  if (S.pf.some((p) => under(f, p))) return block("programfiles", "That's inside Program Files, where installed programs live, so I won't change or delete it. It could break those programs.");
  if (S.pdSystem.some((p) => under(f, p))) return block("programdata", "That's a Windows system part of ProgramData, so I won't change or delete it.");
  const root = parse(f).root, parts = f.slice(root.length).split(/[\\/]+/).filter(Boolean);
  if (parts.length && ROOT_SYSTEM.test(parts[0])) return block("boot", "That's one of Windows' boot, recovery or system folders, so I won't change or delete it.");
  if (BOOTFILE.test(name)) return block("boot", "That's a Windows start-up or memory file, so I won't change or delete it.");
  if (parts.length === 1) {
    const st = statSafe(f);
    // files at the top of a drive (new ones too, unless it's a new folder); the main folders of the Windows drive
    if (st?.isFile() || (!st && opts.kind !== "folder")) return block("rootfile", "That's a file at the very top of a drive, where Windows keeps its start-up files, so I won't change it.");
    if (st?.isDirectory() && lc(root) === lc(S.drive + "\\")) return block("root", `That's one of the main folders on the ${S.drive} drive, so I won't move, rename or delete it.`);
  }
  if (HIVE.test(name)) return block("registry", "That's part of the Windows registry (someone's settings), so I won't change or delete it.");
  if (/[\\/]\.git([\\/]|$)/i.test(f)) return block("git", "That's inside a project's .git folder (its history), so I won't change it directly. Git itself should do that.");
  // Dayspring's own code and data, and the rules and logs that keep me honest
  const allowed = (opts.allow ?? []).some((a) => under(f, a));
  if (!allowed && (opts.protect ?? []).some((p) => p && under(f, p))) return block("dayspring", "That's part of Dayspring itself (its code, its data, its permissions or its activity log), so I can't change or delete it. That keeps me from changing my own safety rules.");
  // other people's profiles
  if (under(f, S.users)) {
    const who = parts[1];
    if (!who) return block("users", "That's the folder that holds everyone's profiles, so I won't change it.");
    if (NOT_PEOPLE.test(who)) return block("profile", "That's a Windows template profile, so I won't change it.");
    // the owner's own: the signed-in profile, and any profile the owner's things live in (Dayspring, the file root, the
    // places they chose one by one); the owner of Dayspring isn't always the signed-in Windows account
    const own = [homedir(), ...(opts.ownPlaces ?? [])].some((p) => p && under(p, join(S.users, who)));
    if (!own && who.toLowerCase() !== "public") return block("profile", `That's in ${who}'s profile, another person's files on this computer, so I won't change or delete it.`);
    if (parts.length === 2 && !/^public$/i.test(who) && existsSync(f)) return block("profile", "That's a whole person's profile folder, so I won't move, rename or delete it.");
  }
  return null;
}
function statSafe(p) { try { return statSync(p); } catch { return null; } }

// ---- allowed, but worth a second thought ------------------------------------------------------------------------------
const BY_NAME = [
  [/^(hosts|lmhosts|networks)$/i, "It's a hosts file, which decides how this computer finds websites. A mistake can block sites or send them to the wrong place."],
  [/^(autoexec\.bat|config\.sys)$/i, "It's a start-up file that runs when the computer starts."],
  [/^(\.bashrc|\.bash_profile|\.bash_login|\.profile|\.zshrc|\.zprofile|\.zshenv|\.inputrc|\.cshrc|\.tcshrc|(microsoft\.)?(powershell|vscode)?_?profile\.ps1)$/i, "It's a shell profile that runs every time you open a terminal. A mistake can break your command line."],
  [/^\.git(config|attributes|modules|ignore)$/i, "It's a Git settings file. A mistake can change how Git treats your projects or what it saves."],
  [/^package\.json$/i, "It describes a project and what it needs to run. A mistake can stop the project from installing or starting."],
  [/^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|gemfile\.lock|poetry\.lock|pipfile\.lock|composer\.lock|packages\.lock\.json|go\.sum)$/i, "It's a lockfile that pins exact versions of what a project uses. Changing it by hand can break installs."],
  [/\.(sln|csproj|vbproj|fsproj|vcxproj|vcxproj\.filters|props|targets|xcodeproj|pbxproj)$/i, "It's a project file for Visual Studio or a similar tool. A mistake can stop the project from building."],
  [/^(dockerfile|containerfile)(\..*)?$|^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i, "It defines how a container is built or run. A mistake can break that app's setup."],
  [/^(\.gitlab-ci\.yml|azure-pipelines\.yml|jenkinsfile|\.travis\.yml|bitbucket-pipelines\.yml|appveyor\.yml|cloudbuild\.ya?ml)$/i, "It's an automated build setup (CI). A mistake can break builds or deployments."],
  [/\.(db|sqlite|sqlite3|db3|mdb|accdb|mdf|ldf|ndf|ibd|frm|realm|dbf|sdf)$/i, "It's a database. Changing it directly can damage the information inside."],
  [/\.(reg)$/i, "It's a registry file. Opening or changing it can change Windows settings."],
  [/\.(exe|dll|sys|msi|msix|appx|com|scr|ocx|drv|cpl)$/i, "It's a program file. Changing it can stop a program from working."],
  [/\.(pst|ost)$/i, "It's an Outlook mail file. Changing it can damage your email."],
];
const BY_PATH = [
  [/[\\/]start menu[\\/]programs[\\/]startup([\\/]|$)/i, "It's in your Startup folder, so it runs every time Windows starts. A mistake here can stop something from starting or start something you don't want."],
  [/[\\/]\.github[\\/]workflows([\\/]|$)|[\\/]\.circleci([\\/]|$)/i, "It's an automated build setup (CI). A mistake can break builds or deployments."],
  [/[\\/]node_modules([\\/]|$)/i, "It's inside node_modules, which a project's installer manages. Changes there get lost or break the project."],
];
const PROJECT_MARKERS = ["package.json", ".git", "pyproject.toml", "setup.py", "cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json", "gemfile", "cmakelists.txt", "makefile"];
const BIG = 100 * 1024 * 1024, OLD_DAYS = 365;
const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;

// op: "create" | "edit" | "move" | "delete" | "copy"
// opts: { usual: [folders the owner uses (Documents, Desktop, their chosen places)], marked: [paths they marked important] }
export function importance(full, op, opts = {}) {
  const f = resolve(full), name = basename(f), out = [];
  const st = statSafe(f);
  const add = (why) => { if (!out.includes(why)) out.push(why); };
  if ((opts.marked ?? []).some((m) => under(f, m))) add("You marked it as important.");
  for (const [re, why] of BY_NAME) if (re.test(name)) add(why);
  for (const [re, why] of BY_PATH) if (re.test(f)) add(why);
  const home = homedir(), S = systemPlaces();
  if (under(f, join(home, "AppData")) && !under(f, join(home, "AppData", "Local", "Temp"))) add("It's in AppData, where programs keep their settings. A mistake can break a program.");
  if (under(f, S.pd)) add("It's in ProgramData, where programs keep settings for everyone on this computer.");
  if (under(f, join(S.users, "Public"))) add("It's in the Public folder, which everyone who uses this computer shares.");
  if (st?.isDirectory() && (op === "delete" || op === "move")) {
    let names = []; try { names = readdirSync(f).map((x) => x.toLowerCase()); } catch { /* unreadable */ }
    if (names.some((n) => PROJECT_MARKERS.includes(n) || /\.(sln|csproj)$/.test(n))) add("It's a whole project folder. Moving or deleting it can break the project and anything that points to it.");
  }
  if (st?.isFile() && op !== "create" && op !== "copy") {
    if (st.size > BIG) add(`It's a large file (${mb(st.size)}). A change is hard to check, and the backup takes space.`);
    if (Date.now() - st.mtimeMs > OLD_DAYS * 86400000) add(`It hasn't changed since ${new Date(st.mtimeMs).toLocaleDateString("en-US", { month: "long", year: "numeric" })}, so it may be something you're keeping on purpose.`);
  }
  const usual = opts.usual ?? [];
  if (usual.length && !usual.some((u) => under(f, u)) && !under(f, join(home, "AppData", "Local", "Temp"))) add("It's outside your usual folders (like Documents, Desktop and the places you chose).");
  return out;
}
// The folders the owner normally keeps things in.
export function usualFolders(extra = []) {
  const home = homedir();
  const known = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive"].map((x) => join(home, x));
  let onedrives = []; try { onedrives = readdirSync(home).filter((n) => /^onedrive/i.test(n)).map((n) => join(home, n)); } catch { /* none */ }
  return [...known, ...onedrives, ...extra].filter(Boolean);
}

// ---- how many files (for bulk confirmations) ---------------------------------------------------------------------------
export function countFiles(dir, cap = 100_000, ms = 5000) {
  const t0 = Date.now();
  let n = 0, bytes = 0, stopped = false;
  const stack = [dir];
  while (stack.length) {
    if (n >= cap || Date.now() - t0 > ms) { stopped = true; break; }
    const d = stack.pop();
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else { n++; try { bytes += statSync(p).size; } catch { /* gone */ } }
    }
  }
  return { files: n, bytes, atLeast: stopped };
}
