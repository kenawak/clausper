// clausper-keys: listens for global hotkeys and prints one line per press.
//
//   clausper-keys stop=ctrl+alt+s mute=ctrl+alt+m
//
// Prints `ready <action> <chord>` or `error <action> <reason>` for each binding,
// then `press <action>` on every press. Uses Carbon's RegisterEventHotKey, which
// needs no Accessibility or Input Monitoring permission and never sees other keys.
// Exits when its parent goes away, so it lives exactly as long as its session,
// and replaces an earlier helper of the same parent (a reloaded mod starts a new one).

import AppKit
import Carbon

let keyCodes: [String: Int] = [
  "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E,
  "f": kVK_ANSI_F, "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J,
  "k": kVK_ANSI_K, "l": kVK_ANSI_L, "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O,
  "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T,
  "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X, "y": kVK_ANSI_Y,
  "z": kVK_ANSI_Z,
  "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4,
  "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
  ".": kVK_ANSI_Period, ",": kVK_ANSI_Comma, "/": kVK_ANSI_Slash, ";": kVK_ANSI_Semicolon,
  "'": kVK_ANSI_Quote, "[": kVK_ANSI_LeftBracket, "]": kVK_ANSI_RightBracket,
  "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal, "`": kVK_ANSI_Grave, "\\": kVK_ANSI_Backslash,
  "space": kVK_Space, "escape": kVK_Escape, "esc": kVK_Escape, "return": kVK_Return,
  "enter": kVK_Return, "tab": kVK_Tab, "delete": kVK_Delete,
  "up": kVK_UpArrow, "down": kVK_DownArrow, "left": kVK_LeftArrow, "right": kVK_RightArrow,
  "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5, "f6": kVK_F6,
  "f7": kVK_F7, "f8": kVK_F8, "f9": kVK_F9, "f10": kVK_F10, "f11": kVK_F11, "f12": kVK_F12,
  "f13": kVK_F13, "f14": kVK_F14, "f15": kVK_F15, "f16": kVK_F16, "f17": kVK_F17,
  "f18": kVK_F18, "f19": kVK_F19,
]

let modifierFlags: [String: Int] = [
  "cmd": cmdKey, "command": cmdKey, "super": cmdKey,
  "shift": shiftKey,
  "alt": optionKey, "opt": optionKey, "option": optionKey,
  "ctrl": controlKey, "control": controlKey,
]

func say(_ line: String) {
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

enum Chord {
  case key(code: UInt32, modifiers: UInt32)
  case invalid(String)
}

// "ctrl+alt+s" -> its key code and Carbon modifiers, or the reason it is not a chord.
func parse(_ chord: String) -> Chord {
  let parts = chord.lowercased().split(separator: "+").map(String.init)
  guard let key = parts.last, let code = keyCodes[key] else { return .invalid("unknown key in \(chord)") }
  var modifiers = 0
  for part in parts.dropLast() {
    guard let flag = modifierFlags[part] else { return .invalid("unknown modifier \(part) in \(chord)") }
    modifiers |= flag
  }
  if modifiers == 0 && !key.hasPrefix("f") { return .invalid("\(chord) needs a modifier") }
  return .key(code: UInt32(code), modifiers: UInt32(modifiers))
}


let parent = getppid()
// Started by nobody (or orphaned already): there is no session to serve.
if parent == 1 { exit(0) }
let pidFile = NSHomeDirectory() + "/.clausper/run/keys-\(parent).pid"

// One helper per parent: ~/.clausper/run/keys-<parent>.pid names the live one.
func replaceEarlier() {
  let run = NSHomeDirectory() + "/.clausper/run"
  try? FileManager.default.createDirectory(atPath: run, withIntermediateDirectories: true,
                                           attributes: [.posixPermissions: 0o700])
  if let text = try? String(contentsOfFile: pidFile, encoding: .utf8),
     let earlier = pid_t(text.trimmingCharacters(in: .whitespacesAndNewlines)), earlier != getpid() {
    // Only a clausper-keys: a pid can be reused by any process once its helper is gone.
    var path = [CChar](repeating: 0, count: 4096)
    if proc_pidpath(earlier, &path, UInt32(path.count)) > 0,
       String(cString: path).hasSuffix("/clausper-keys") {
      kill(earlier, SIGTERM)
    }
  }
  try? "\(getpid())\n".write(toFile: pidFile, atomically: true, encoding: .utf8)
}

replaceEarlier()

var actions: [UInt32: String] = [:]
var refs: [EventHotKeyRef?] = []

var pressed = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
  var id = EventHotKeyID()
  GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                    MemoryLayout<EventHotKeyID>.size, nil, &id)
  if let action = actions[id.id] { say("press \(action)") }
  return noErr
}, 1, &pressed, nil, nil)

for (index, argument) in CommandLine.arguments.dropFirst().enumerated() {
  let pair = argument.split(separator: "=", maxSplits: 1).map(String.init)
  guard pair.count == 2 else { say("error \(argument) not action=chord"); continue }
  let (action, chord) = (pair[0], pair[1])
  switch parse(chord) {
  case .invalid(let reason):
    say("error \(action) \(reason)")
  case .key(let code, let modifiers):
    let id = UInt32(index + 1)
    var ref: EventHotKeyRef?
    let status = RegisterEventHotKey(code, modifiers, EventHotKeyID(signature: OSType(0x434C_5350), id: id),
                                     GetApplicationEventTarget(), 0, &ref)
    if status == noErr {
      actions[id] = action
      refs.append(ref)
      say("ready \(action) \(chord)")
    } else {
      say("error \(action) \(chord) is taken (\(status))")
    }
  }
}

Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
  if getppid() != parent {
    try? FileManager.default.removeItem(atPath: pidFile)
    exit(0)
  }
}
// A background process: no Dock icon, no menu bar, never takes the focus.
NSApplication.shared.setActivationPolicy(.prohibited)
NSApplication.shared.run()
