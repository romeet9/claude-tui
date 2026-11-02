// claude-tui voice helper: live speech-to-text with macOS's own recognizer.
// Prints JSON lines: {"partial": "..."} while listening, {"final": "..."} at the end,
// {"error": "..."} on failure. Stops when stdin closes or on SIGTERM/SIGINT.
//
// Long dictation: after a pause the recognizer either starts a new segment (its
// transcription then holds only the new words) or ends the task (isFinal / error;
// there is also a time limit per task). Either way the earlier words would be lost,
// so finished stretches are kept in `committed` and a fresh task is started on the
// same microphone stream. Partial and final output is always the whole dictation.
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ key: String, _ value: String) {
    if let data = try? JSONSerialization.data(withJSONObject: [key: value]),
       let line = String(data: data, encoding: .utf8) {
        print(line)
    }
}

let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
let engine = AVAudioEngine()

/** Text from earlier stretches of speech (finished tasks or segments). */
var committed = ""
/** The live text of the current task. */
var current = ""
/** First-word timestamp of the current transcription (0 while the recognizer hasn't timed it). */
var currentStart: TimeInterval = 0
var finished = false

/** The request the microphone feeds; replaced when a task ends. Only touched on the main queue. */
var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?
/** Bumped per task, so late callbacks from an old task are ignored. */
var generation = 0
/** Tasks that failed right away without hearing anything; too many in a row = give up. */
var quickFails = 0
var taskStarted = Date()
var taskHeard = false

func full() -> String {
    [committed, current].filter { !$0.isEmpty }.joined(separator: " ")
}

func commitCurrent() {
    let text = current.trimmingCharacters(in: .whitespaces)
    if !text.isEmpty { committed = committed.isEmpty ? text : committed + " " + text }
    current = ""
    currentStart = 0
}

func words(_ s: String) -> [String] {
    s.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
}

/**
 * Did the recognizer drop what it had and start over with new words? Revisions of the
 * same stretch keep their opening words and roughly their length; a new segment starts
 * later in the audio or with different, much shorter text.
 */
func isNewSegment(old: String, new: String, newStart: TimeInterval) -> Bool {
    if old.isEmpty { return false }
    if newStart > 0 && currentStart > 0 && newStart > currentStart + 0.5 { return true }
    let o = words(old), n = words(new)
    if n.isEmpty { return false }
    let shared = zip(o, n).prefix(while: { $0 == $1 }).count
    return shared == 0 && n.count < max(2, o.count / 2)
}

func newTask() {
    guard let recognizer, !finished else { return }
    generation += 1
    let gen = generation
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
    req.addsPunctuation = true
    request = req
    taskStarted = Date()
    taskHeard = false
    task = recognizer.recognitionTask(with: req) { result, error in
        DispatchQueue.main.async {
            guard gen == generation else { return }
            if let result {
                taskHeard = true
                quickFails = 0
                let text = result.bestTranscription.formattedString
                let start = result.bestTranscription.segments.first?.timestamp ?? 0
                if isNewSegment(old: current, new: text, newStart: start) { commitCurrent() }
                current = text
                if start > 0 && currentStart == 0 { currentStart = start }
                emit("partial", full())
                if result.isFinal {
                    // The task is over (a pause or its time limit): keep the words, keep listening.
                    commitCurrent()
                    if !finished { newTask() } else { done() }
                    return
                }
            }
            if error != nil {
                commitCurrent()
                if !taskHeard && Date().timeIntervalSince(taskStarted) < 1.0 { quickFails += 1 } else { quickFails = 0 }
                if finished { done() }
                else if quickFails >= 5 {
                    emit("error", "Speech recognition keeps failing: \(error!.localizedDescription)")
                    finish()
                }
                else {
                    // Silence or a limit ended the task; start another after a moment.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { if gen == generation { newTask() } }
                }
            }
        }
    }
}

var printed = false
func done() {
    if printed { return }
    printed = true
    emit("final", full())
    exit(0)
}

func finish() {
    if finished { return }
    finished = true
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    // Give the recognizer a moment to settle the last words, then print whatever we have.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
        commitCurrent()
        done()
    }
}

func start() {
    guard let recognizer, recognizer.isAvailable else {
        emit("error", "Speech recognition isn't available for this language right now.")
        exit(1)
    }
    _ = recognizer
    let input = engine.inputNode
    // Apple's voice processing (as in FaceTime): cancels whatever this Mac is playing
    // (a YouTube video, music) and suppresses background noise, so only your voice is
    // transcribed. Other audio is barely lowered while listening.
    do {
        try input.setVoiceProcessingEnabled(true)
        if #available(macOS 14.0, *) {
            input.voiceProcessingOtherAudioDuckingConfiguration =
                AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
        }
    } catch {
        // Not fatal: dictation still works, just without echo and noise suppression.
    }
    // Read the format after enabling voice processing: it changes the input format.
    let format = input.outputFormat(forBus: 0)
    // The tap runs on an audio thread; hop to main so `request` is never read mid-swap.
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        DispatchQueue.main.async { request?.append(buffer) }
    }
    newTask()
    do {
        engine.prepare()
        try engine.start()
        emit("ready", "")
    } catch {
        emit("error", "Couldn't use the microphone: \(error.localizedDescription)")
        exit(1)
    }
}

for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler { finish() }
    src.resume()
    _ = Unmanaged.passRetained(src)
}
// Stdin closing (the app quitting) also stops listening.
DispatchQueue.global().async {
    while readLine() != nil {}
    DispatchQueue.main.async { finish() }
}

SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        switch status {
        case .authorized:
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                DispatchQueue.main.async {
                    if ok { start() } else {
                        emit("error", "Microphone access is off: System Settings → Privacy & Security → Microphone → Terminal.")
                        exit(1)
                    }
                }
            }
        default:
            emit("error", "Speech recognition is off: System Settings → Privacy & Security → Speech Recognition → Terminal.")
            exit(1)
        }
    }
}

dispatchMain()
