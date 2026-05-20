/**
 * MediBridge — 진료실 녹음 경량화 (모노 · 16kHz · ~24kbps)
 */
(function (global) {
  "use strict";

  var CLINIC_AUDIO_BITS_PER_SECOND = 24000;
  var CLINIC_SAMPLE_RATE_IDEAL = 16000;

  function getClinicAudioConstraints() {
    return {
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: CLINIC_SAMPLE_RATE_IDEAL },
      },
    };
  }

  function getSupportedClinicMimeType() {
    var types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (var i = 0; i < types.length; i++) {
      if (global.MediaRecorder && global.MediaRecorder.isTypeSupported(types[i])) {
        return types[i];
      }
    }
    return "";
  }

  function buildMediaRecorderOptions(mimeType) {
    var opts = { audioBitsPerSecond: CLINIC_AUDIO_BITS_PER_SECOND };
    if (mimeType) opts.mimeType = mimeType;
    return opts;
  }

  function createMediaRecorder(stream, mimeType) {
    var options = buildMediaRecorderOptions(mimeType);
    try {
      return new global.MediaRecorder(stream, options);
    } catch (err) {
      if (mimeType) {
        try {
          return new global.MediaRecorder(stream, {
            mimeType: mimeType,
            audioBitsPerSecond: CLINIC_AUDIO_BITS_PER_SECOND,
          });
        } catch (err2) {
          try {
            return new global.MediaRecorder(stream, { mimeType: mimeType });
          } catch (err3) {
            /* fall through */
          }
        }
      }
      return new global.MediaRecorder(stream);
    }
  }

  global.MediBridgeClinicAudio = {
    CLINIC_AUDIO_BITS_PER_SECOND: CLINIC_AUDIO_BITS_PER_SECOND,
    CLINIC_SAMPLE_RATE_IDEAL: CLINIC_SAMPLE_RATE_IDEAL,
    getClinicAudioConstraints: getClinicAudioConstraints,
    getSupportedClinicMimeType: getSupportedClinicMimeType,
    buildMediaRecorderOptions: buildMediaRecorderOptions,
    createMediaRecorder: createMediaRecorder,
  };
})(typeof window !== "undefined" ? window : globalThis);
