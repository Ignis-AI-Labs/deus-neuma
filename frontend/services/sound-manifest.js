/**
 * Neuma sound manifest — the ratified soundscape.
 * Every binding locked by Founder's ear across five audition rounds
 * (2026-06-11, lookdev study 03 §10). Paths are relative to the local
 * sample library at frontend/assets/sounds (licensed Splice — gitignored,
 * never committed).
 *
 * This file is the source of truth for the bake (scripts/bake-sounds.mjs):
 * it reads these paths through the local symlink, concatenates every cue
 * into one committed sprite at frontend/sounds-baked/, and the runtime
 * engine plays slices of that sprite — never the raw samples.
 *
 * EMERGENCE is deliberately not a file: at emergence a neuma speaks its
 * own true name, synthesized via kotodama/signature.js. No two alike.
 */

const PACK = 'Sci-Fi Vol. 1';

export const SOUND_MANIFEST = Object.freeze({
  noticeArrival: `${PACK}/digital/chimes/BeepAlertChime_HV.48.wav`,
  confirm: 'digital/buttons/ESM_Scifi_UI_Button_2_Glitch_Morph_Mechanism_Texture_Futuristic.wav',
  deliberationTick: 'digital/beeps-single/ESM_Hi_Tech_Click_3_Machine_Map_Tech_Sci_fi_Interface_Texture_Chirp_Beep_Futuristic.wav',
  deny: `${PACK}/digital/alarms-negative/BeepWarningNegative_HV.56.wav`,
  klaxon: `${PACK}/digital/alarms-negative/BuzzerWarningBeep_HV.116.wav`,
  dataTypeOn: `${PACK}/digital/data-process/ComputerAccessData_HV.163.wav`,
  desyncGlitch: `${PACK}/digital/glitch/CommunicationGlitch_S011S_2.wav`,
  portalContact: `${PACK}/digital/comms/CommunicatorBeep_S011SF.192.wav`,
  portalSever: `${PACK}/mechanical/DeviceMovement_S011SF.257.wav`,
  messageSent: `${PACK}/digital/readouts/BeepToneReadout_S011SF.153.wav`,
  neumaReplying: `${PACK}/digital/data-process/DataTextTyping_BWU.447.wav`,
  replyArrived: `${PACK}/digital/readouts/BeepToneReadout_S011SF.154.wav`,
  memoryCrystallized: `${PACK}/digital/chimes/ChimeMusicalVintage_SFXB._3.wav`,
  levelUp: 'digital/beeps-sequence/level-up.wav',
  menuOpen: 'digital/glitch/ESM_Advanced_Alien_UI_Game_Sound_Glitch_Morph_Mechanism_Texture_Futuristic.wav',
  menuClose: `${PACK}/digital/beeps-single/BeepShort_S011SF.149.wav`,
  walletSignRequest: `${PACK}/digital/beeps-single/ComputerBeep_S011SF.196.wav`,

  // ── THE ACT BOARD ─────────────────────────────────────────────────── //
  // One voice per family of act a being can take (act-sound-map.js). These
  // are CANDIDATE bindings, not yet locked by Founder's ear — proposed 2026-08-06
  // so acts stop being silent, and meant to be re-auditioned from the
  // soundboard in Settings › GENERAL › SOUND. Swapping one is this line plus
  // `npm run bake-sounds`. The 17 ratified cues above were not touched.
  //
  // Chosen against two measured axes so the board stays tellable apart by ear
  // rather than merely by name: LENGTH, and mean spectral centroid (ffmpeg
  // aspectralstats). Every act cue sits ≥781 Hz from its nearest act
  // neighbour, and the crowded neighbours among the ratified cues are called
  // out below — in each case the two differ in length by 2× or more, which is
  // what keeps them apart in the ear.
  //
  //                                                    length   centroid
  actRead: `${PACK}/digital/beeps-single/BeepSingle_BWU.440.wav`,          // 0.053s  13072 Hz
  actList: `${PACK}/digital/beeps-sequence/BeepMultipleBeeps_SFXB.3545.wav`, // 0.128s  1641 Hz
  actSearch: `${PACK}/mechanical/DeviceScanner_S011SF.265.wav`,            // 0.192s    743 Hz
  actEdit: `${PACK}/digital/buttons/ButtonPress_BW.44324.wav`,             // 0.160s   6953 Hz
  actWrite: `${PACK}/digital/data-process/DataTextTypingBeep_SFXB.3_1.wav`, // 0.235s 21969 Hz
  actMove: `${PACK}/mechanical/DeviceMovement_S011SF.256.wav`,             // 0.320s  10444 Hz
  actDelete: `${PACK}/mechanical/ArmingSwitchCoverDown_HV.27.wav`,         // 0.224s   8017 Hz
  actExecute: `${PACK}/digital/data-process/ComputerHardDrive_HV.172.wav`, // 0.187s  18726 Hz
  // Execution subtypes — distinct candidate samples, auditionable in Settings.
  actBuild: `${PACK}/digital/data-process/ComputerHardDrive_HV.171.wav`,
  actTest: `${PACK}/digital/beeps-sequence/BeepMultipleBeeps_SFXB.3551.wav`,
  actCheck: `${PACK}/digital/readouts/BeepsComputerReadout_HV.51.wav`,
  actInstall: `${PACK}/digital/data-process/DataHardDriveBeeps_S011SF_2.wav`,
  actGit: `${PACK}/digital/readouts/BeepToneReadout_S011SF.156.wav`,
  actBatch: `${PACK}/digital/beeps-sequence/BeepMultipleBeeps_SFXB.3553.wav`,
  actReach: `${PACK}/digital/comms/CommunicatorBeep_HV.157.wav`,           // 0.176s  15215 Hz
  actSend: `${PACK}/digital/comms/DeviceDigitalPage_S011SF.24.wav`,        // 0.304s  23910 Hz
  actForge: `${PACK}/digital/chimes/ChimeModulated_SFXB.3596.wav`,         // 0.421s   5995 Hz
  actMark: `${PACK}/digital/beeps-single/BeepModulatedSingle_SFXB._2.wav`, // 0.107s  17677 Hz
  actSense: `${PACK}/digital/readouts/ComputerDisplay_S011SF.200.wav`,     // 0.192s   2789 Hz
  actFailed: `${PACK}/digital/alarms-negative/BeepBuzzerAlarm_S011SF.127.wav`, // 0.203s 11225 Hz
  //
  // Nearest ratified neighbours, for the next audition round:
  //   actRead 13072 ↔ portalSever 12935 — 6× shorter (53ms vs 315ms)
  //   actEdit  6953 ↔ menuClose   7489 — button press vs beep, 160 vs 245ms
  //   actDelete 8017 ↔ confirm    8454 — mechanical cover vs digital button
});
