"""Original, deterministic instrumental score for the Tándem concept film.

Run with an existing Python environment containing NumPy:
    python compose_music.py

Uses local ffmpeg for two-pass -20 LUFS normalisation and loudness QA.
No samples, recordings, voice models, downloads or online services.
"""
from pathlib import Path
import json
import subprocess
import wave

import numpy as np


ROOT = Path(__file__).resolve().parent
SR = 48000
DURATION = 45.0
BPM = 96
BEAT = 60 / BPM  # 72 beats / 18 complete bars in exactly 45 seconds.
FRAMES = int(DURATION * SR)
SEED = 20261018
TARGET_LUFS = -20.0
SOURCE = ROOT / "assets" / "tandem-original-score.wav"
MASTER = ROOT / "assets" / "tandem-music.wav"
INTERACTIONS = ((7.3, 76, 0.023), (28.1, 76, 0.020), (29.2, 79, 0.019))
SCENES = (
    (0, 4, "parked truck intro"),
    (4, 10, "contact invite and accept"),
    (10, 15, "driver confirmation"),
    (15, 20, "driving"),
    (20, 26, "parked fuel pause"),
    (26, 32, "parked OK"),
    (32, 37, "parked SOS"),
    (37, 42, "contact reads SOS"),
    (42, 45, "brand ending; SOS remains open"),
)


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def release_envelope(t, seconds, release):
    remaining = np.clip((seconds - t) / release, 0, 1)
    return np.sin(np.pi / 2 * remaining) ** 2


def pad(note, seconds):
    t = np.arange(round(seconds * SR)) / SR
    attack = np.sin(np.pi / 2 * np.minimum(t / 0.75, 1)) ** 2
    env = attack * release_envelope(t, seconds, min(1.3, seconds / 2))
    freq = hz(note)
    return env * (
        np.sin(2 * np.pi * freq * t)
        + 0.22 * np.sin(2 * np.pi * freq * 2.002 * t)
        + 0.06 * np.sin(2 * np.pi * freq * 3 * t)
    )


def pluck(note, seconds=1.65):
    t = np.arange(round(seconds * SR)) / SR
    env = (1 - np.exp(-t * 130)) * np.exp(-t * 3.6)
    env *= release_envelope(t, seconds, 0.16)
    freq = hz(note)
    return env * (
        np.sin(2 * np.pi * freq * t)
        + 0.19 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 2)
        + 0.07 * np.sin(2 * np.pi * freq * 3 * t) * np.exp(-t * 5)
    )


def bass(note, seconds=0.85):
    t = np.arange(round(seconds * SR)) / SR
    env = (1 - np.exp(-t * 65)) * np.exp(-t * 4.3)
    env *= release_envelope(t, seconds, 0.18)
    return env * (
        np.sin(2 * np.pi * hz(note) * t)
        + 0.12 * np.sin(4 * np.pi * hz(note) * t)
    )


def interaction(note):
    """One rounded, short fixed-pitch tone; no sweep or second onset."""
    seconds = 0.52
    t = np.arange(round(seconds * SR)) / SR
    env = np.sin(np.pi / 2 * np.minimum(t / 0.016, 1)) ** 2
    env *= np.exp(-t * 8) * release_envelope(t, seconds, 0.15)
    freq = hz(note)
    return env * (np.sin(2 * np.pi * freq * t) + 0.08 * np.sin(4 * np.pi * freq * t))


def compose():
    rng = np.random.default_rng(SEED)
    mix = np.zeros((FRAMES, 2), dtype=np.float64)

    def add(signal, start, gain=1.0, pan=0.0):
        offset = round(start * SR)
        end = offset + len(signal)
        if offset < 0 or end > FRAMES:
            raise ValueError(f"Note exceeds score bounds: {start}s to {end / SR}s")
        signal = signal * gain
        mix[offset:end, 0] += signal * np.sqrt((1 - pan) / 2)
        mix[offset:end, 1] += signal * np.sqrt((1 + pan) / 2)

    # Retain the original Gadd9 / Cmaj7 / Em9 / Dsus2 harmonic identity.
    chords = ((55, 59, 62, 69), (48, 55, 59, 64), (52, 55, 59, 66), (50, 57, 62, 64))
    roots = (43, 36, 40, 38)
    motifs = ((74, 71, 69, 67), (76, 74, 71, 67), (71, 69, 67, 66), (69, 74, 76, 74))
    pans = (-0.26, 0.22, -0.17, 0.27)
    for bar in range(18):
        start = bar * 4 * BEAT
        harmony = (bar // 2) % 4
        chord = chords[harmony]
        # Each final note ends naturally at 44.85, before a silent 150 ms tail.
        seconds = min(3.65, 44.85 - start)
        for i, note in enumerate(chord):
            add(pad(note, seconds), start, 0.034, (i - 1.5) * 0.29)

        for j in range(4):
            at = start + j * BEAT
            if 32 <= at < 37 or at >= 40:
                continue
            # Motion belongs to the confirmation/driving passage. Parked
            # sections use only a sparse low anchor rather than a motor pulse.
            if 10 <= at < 20:
                if j % 2 == 0:
                    add(bass(roots[harmony]), at, 0.052 if j == 0 else 0.034)
            elif j == 0:
                add(bass(roots[harmony]), at, 0.033)

        if bar % 2 == 0 and start < 30:
            for j, note in enumerate(motifs[harmony]):
                at = start + (j * 0.75 + 0.25) * BEAT
                # Give the three UI tones a little melodic breathing room.
                if any(abs(at - cue[0]) < 0.42 for cue in INTERACTIONS):
                    continue
                gain = 0.060 if start < 20 else 0.046
                add(pluck(note), at, gain, pans[j])
                add(pluck(note), at + 0.30, gain * 0.15, -pans[j])
        elif bar % 4 == 3 and start < 30:
            at = start + 1.5 * BEAT
            if all(abs(at - cue[0]) >= 0.42 for cue in INTERACTIONS):
                add(pluck(chord[2] + 12, 2.1), at, 0.031, 0.12)

    # Brief, soft brush and low drum only while confirming/driving, 10–20s.
    for beat in range(16, 32):
        at = beat * BEAT
        if beat % 2 == 0:
            seconds = 0.24
            t = np.arange(round(seconds * SR)) / SR
            kick = np.sin(2 * np.pi * (53 * t + 10 / 28 * (1 - np.exp(-28 * t))))
            env = np.exp(-24 * t) * np.minimum(t / 0.008, 1)
            add(kick * env * release_envelope(t, seconds, 0.04), at, 0.026)
        else:
            seconds = 0.075
            t = np.arange(round(seconds * SR)) / SR
            noise = rng.normal(0, 1, len(t))
            high = noise - np.convolve(noise, np.ones(11) / 11, mode="same")
            env = np.exp(-65 * t) * np.minimum(t / 0.005, 1)
            add(high * env * release_envelope(t, seconds, 0.02), at, 0.004, 0.32)

    # The SOS and contact-read scenes remain a continuous, quieter pad.
    # No alert at 33.5/34.4, no confirmation at 39.5, no rescue-resolution cue.
    # A familiar open Gadd9 voicing settles on the last bar without a fanfare.
    add(bass(43, 2.0), 40.0, 0.025)
    add(pluck(67, 2.35), 42.5, 0.035, -0.10)
    add(pluck(74, 2.35), 42.5, 0.021, 0.10)

    t = np.arange(FRAMES) / SR
    envelope = np.interp(
        t,
        [0, 0.7, 4, 10, 15, 19.7, 20.5, 26, 30.8, 32, 37, 38, 42, 43, 44.85, 45],
        [0, 0.72, 0.80, 0.85, 0.92, 0.92, 0.76, 0.81, 0.78, 0.38, 0.38, 0.49, 0.58, 0.56, 0, 0],
    )
    mix *= envelope[:, None]

    # Exactly three separate interaction events, all prior to the SOS passage.
    for at, note, gain in INTERACTIONS:
        add(interaction(note), at, gain)

    # Gentle saturation and source headroom; ffmpeg sets delivery loudness.
    mix = np.tanh(mix * 1.15)
    mix *= 0.68 / max(float(np.max(np.abs(mix))), 0.001)
    return mix


def loudness(path):
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-i", str(path), "-af",
         f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json",
         "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    return json.JSONDecoder().raw_decode(result.stderr[result.stderr.rfind("{"):])[0]


def normalise():
    measured = loudness(SOURCE)
    settings = (
        f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:linear=true"
        f":measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
        f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
        f":offset={measured['target_offset']}"
        f",apad=whole_len={FRAMES},atrim=end_sample={FRAMES},asetpts=N/SR/TB"
    )
    subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(SOURCE),
         "-map_metadata", "-1", "-af", settings, "-ar", str(SR), "-ac", "2",
         "-c:a", "pcm_s16le", str(MASTER)],
        check=True,
    )


def audio_qa():
    measured = loudness(MASTER)
    files = {}
    for path in (SOURCE, MASTER):
        with wave.open(str(path), "rb") as wav:
            if (wav.getnframes(), wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (FRAMES, SR, 2, 2):
                raise RuntimeError(f"Unexpected WAV format or duration: {path}")
            pcm = np.frombuffer(wav.readframes(FRAMES), dtype="<i2").reshape(-1, 2)
        if np.any(pcm[0]) or np.any(pcm[-round(0.15 * SR):]):
            raise RuntimeError(f"Expected zero-valued opening and silent ending: {path}")
        if np.max(np.abs(pcm.astype(np.int32))) >= 32767:
            raise RuntimeError(f"Clipped samples: {path}")
        files[str(path.relative_to(ROOT))] = {
            "frames": FRAMES, "durationSeconds": FRAMES / SR,
            "sampleRate": SR, "channels": 2, "bitsPerSample": 16,
        }

    audio = pcm.astype(np.float64) / 32768

    def rms_db(start, end):
        section = audio[round(start * SR):round(end * SR)]
        return float(20 * np.log10(max(float(np.sqrt(np.mean(section ** 2))), 1e-12)))

    sections = {f"{start}-{end}s {name}": round(rms_db(start, end), 2) for start, end, name in SCENES}
    sos_reduction = rms_db(26, 32) - rms_db(32, 37)
    integrated = float(measured["input_i"])
    true_peak = float(measured["input_tp"])
    if abs(integrated - TARGET_LUFS) > 0.15 or true_peak > -1.5:
        raise RuntimeError(f"Delivery loudness outside target: {measured}")
    if sos_reduction < 4:
        raise RuntimeError(f"SOS scene needs a clear reduction: {sos_reduction:.2f} dB")
    return {
        "files": files,
        "integratedLufs": integrated,
        "truePeakDbtp": true_peak,
        "loudnessRangeLu": float(measured["input_lra"]),
        "sosReductionVsOkDb": round(sos_reduction, 2),
        "sceneRmsDbfs": sections,
        "clippedSamples": 0,
        "lastSilentMilliseconds": 150,
        "maxAbsoluteDcOffset": round(float(np.max(np.abs(np.mean(audio, axis=0)))), 7),
        "stereoCorrelation": round(float(np.corrcoef(audio.T)[0, 1]), 4),
        "verification": "ffmpeg loudnorm remeasurement and PCM checks; no listening review claimed",
    }


def main():
    # Fail before touching audio if provenance is unavailable. Keep unrelated
    # motion/visual credits and all existing music attribution fields intact.
    credits_path = ROOT / "credits.json"
    credits = json.loads(credits_path.read_text())
    entry = next(item for item in credits["music"] if item["file"] == str(SOURCE.relative_to(ROOT)))
    mix = compose()
    with wave.open(str(SOURCE), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(np.rint(mix * 32767).astype("<i2").tobytes())
    normalise()
    qa = audio_qa()
    entry.update({
        "duration": DURATION, "bpm": BPM, "voice": False,
        "renderedFile": str(MASTER.relative_to(ROOT)),
        "measuredIntegratedLufs": qa["integratedLufs"],
        "measuredTruePeakDbfs": qa["truePeakDbtp"],
        "measuredLoudnessRangeLu": qa["loudnessRangeLu"],
        "seed": SEED, "bars": 18,
        "normalisation": "Local ffmpeg loudnorm, measured two-pass linear, -20 LUFS / -1.5 dBTP ceiling",
        "interactionTones": [
            {"timeSeconds": at, "sampleOffset": round(at * SR), "midiNote": note,
             "durationSeconds": 0.52, "method": "Original soft fixed-pitch oscillator, no samples"}
            for at, note, gain in INTERACTIONS
        ],
        "arrangement": {
            "scenes": [{"startSeconds": start, "endSeconds": end, "scene": name} for start, end, name in SCENES],
            "quietPassageSeconds": [32, 37],
            "lastMusicalOnsetSeconds": 42.5,
            "naturalReleaseEndsSeconds": 44.85,
            "ending": "Warm open Gadd9, no alarm, triumph or SOS-resolution cue; SOS remains open",
            "voice": False, "externalSamples": False, "remoteServices": False,
        },
        "audioQa": qa,
    })
    credits_path.write_text(json.dumps(credits, indent=2) + "\n")
    print(json.dumps({"source": str(SOURCE), "master": str(MASTER), "audioQa": qa}, indent=2))


if __name__ == "__main__":
    main()
