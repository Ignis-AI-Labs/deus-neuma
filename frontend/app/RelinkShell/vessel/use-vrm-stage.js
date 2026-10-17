// use-vrm-stage.js — a VRM vessel rendered into a sized container.
//
// impure hook: builds a three.js scene (camera, lights, renderer), loads the
// active vessel's VRM, plays a looping idle, drives orbit controls, and sizes
// the renderer to the container via a ResizeObserver. The canvas mounts into
// the passed ref — never document.body — and the whole stage disposes on
// unmount (RAF cancelled, observer disconnected, mixer + GPU resources freed)
// so the window can open and close without leaking WebGL contexts. Render
// pauses when the container collapses to zero height (the window-shade).
//
// Idle: a mocap clip (neutral_idle.bvh) retargeted onto the VRM humanoid so
// the vessel rests with arms down and breathes, instead of standing in the
// raw T-pose. INTERIM — shared VRMA animation delivery is not implemented;
// the runtime reuses the existing BVH for now (no runtime retarget).
// If the clip can't load, a procedural breath keeps the vessel from freezing.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VRMUtils } from '@pixiv/three-vrm';
import { createVesselLoader } from './vessel-loader.js';
import { createExpressionDriver } from './expression-driver.js';
import { decideEmotionApply } from './vessel-signals.js';

const IDLE_URL = '/animation/neutral_idle.bvh'; // singular path = the proxied one

// Retarget a BVH clip (bones already named for the VRM humanoid) onto the
// vrm's normalized skeleton. Mirrors the established three-vrm BVH recipe:
// rebase each rotation into the VRM rest frame, scale hips translation, and
// flip X/Z for VRM0 metadata. Pure given its inputs.
const retargetBVH = (result, vrm, name) => {
  const { clip, skeleton } = result;
  const tracks = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const quat = new THREE.Quaternion();

  const vrmHips = vrm.humanoid.getNormalizedBoneNode('hips');
  const vrmHipsY = vrmHips ? Math.abs(vrmHips.position.y) : 1;
  const motionHips = skeleton.getBoneByName('hips');
  const hipsScale = motionHips ? vrmHipsY / motionHips.position.y : 1;
  const isVRM0 = vrm.meta?.metaVersion === '0';

  clip.tracks.forEach((track) => {
    const [boneName, property] = track.name.split('.');
    const vrmNode = vrm.humanoid.getNormalizedBoneNode(boneName);
    const rigNode = skeleton.getBoneByName(boneName);
    if (!vrmNode || !rigNode) return;

    rigNode.getWorldQuaternion(restRotationInverse).invert();
    if (rigNode.parent) rigNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = track.values.slice();
      for (let i = 0; i < values.length; i += 4) {
        quat.fromArray(values, i).premultiply(parentRestWorldRotation).multiply(restRotationInverse).toArray(values, i);
        if (isVRM0) { values[i] = -values[i]; values[i + 2] = -values[i + 2]; } // flip X, Z
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmNode.name}.${property}`, track.times.slice(), values));
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      const values = track.values.map((v, i) => (isVRM0 && i % 3 !== 1 ? -v : v) * hipsScale);
      tracks.push(new THREE.VectorKeyframeTrack(`${vrmNode.name}.${property}`, track.times.slice(), values));
    }
  });

  return new THREE.AnimationClip(name, clip.duration, tracks);
};

// Procedural fallback: a quiet breath + micro-sway when no clip is playing, so
// a still vessel never reads dead. Drives normalized humanoid bones.
const applyIdleBreath = (vrm, t) => {
  const h = vrm.humanoid;
  if (!h) return;
  const chest = h.getNormalizedBoneNode('chest') || h.getNormalizedBoneNode('upperChest');
  if (chest) {
    chest.rotation.x = Math.sin(t * 0.5) * 0.008;
    chest.position.y = Math.sin(t * 0.5) * 0.002;
  }
  const head = h.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.x = Math.sin(t * 0.3) * 0.02 - 0.05;
    head.rotation.y = Math.sin(t * 0.2) * 0.03;
  }
  const spine = h.getNormalizedBoneNode('spine');
  if (spine) spine.rotation.z = Math.sin(t * 0.4) * 0.005;
};

// Build the scene/camera/renderer/lights/orbit for a canvas. The renderer
// drawing buffer is sized later by the container observer (updateStyle off —
// CSS keeps the canvas filling its box).
//
// Showcase render path (2026-07-08): PBR materials only read as real under
// image-based lighting + a filmic tone curve, so the stage now provides both.
//   - IBL: a procedural neutral-studio environment (RoomEnvironment, no external
//     HDRI asset) is prefiltered into scene.environment — this is what gives skin
//     and reflective surfaces correct ambient + specular response. background is
//     left transparent (alpha) so the vessel still floats in the UI void.
//   - Tone mapping: AgX (neutral, filmic — kinder to skin than ACES) so highlights
//     roll off instead of clipping to plastic-white.
//   - Shadows: a soft contact shadow grounds the vessel via a transparent
//     ShadowMaterial catcher (only the shadow shows; the void stays void).
// The three analytic lights are retuned DOWN because the environment now carries
// the ambient/fill — they shape and accent (the SIGNAL rim is brand, kept).
const buildStage = (canvas) => {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 1.35, 2.6);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // keep the void transparent through the composer
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0; // tune to taste per showcase lookdev
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap; // genuinely soft (PCFSoft is deprecated in three r184+)

  // IBL — prefilter a neutral studio env into an irradiance/specular map. Own the
  // PMREM target + source scene so both can be freed on unmount (disposeStage).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envTarget = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.9; // IBL strength; tune with lookdev

  // Analytic lights now shape/accent on top of the IBL fill (intensities in the
  // physically-based range three uses since legacy lights were removed).
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, 2, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.camera.left = -2;
  key.shadow.camera.right = 2;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -1;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 8; // VSM blur radius — soft contact shadow
  key.shadow.blurSamples = 16;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x5fe9ff, 1.4); // SIGNAL rim — silhouette against the void
  rim.position.set(-1.5, 1, -1.5);
  scene.add(rim);

  // Contact-shadow catcher: invisible except where the key light casts a shadow,
  // so the vessel gets grounded without painting a floor over the transparent bg.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.32 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 0.6;
  controls.maxDistance = 6;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.maxPolarAngle = Math.PI * 0.82;
  controls.target.set(0, 1.15, 0);
  controls.update();

  // Post chain: ground-truth ambient occlusion (GTAO) darkens the crevices bare
  // IBL can't reach — under the chin/jaw, the neck, clothing folds — which is a
  // large part of what reads as "grounded/real". OutputPass applies the AgX tone
  // curve + sRGB once at the end (RenderPass targets are linear, so no double
  // tone-map). The composer preserves alpha, so the void stays transparent.
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  renderPass.clearAlpha = 0;
  composer.addPass(renderPass);
  const gtao = new GTAOPass(scene, camera, 1, 1, undefined, {
    radius: 0.25, // world units — tuned to a ~human-scale head/torso
    distanceExponent: 1,
    thickness: 1,
    scale: 1,
    samples: 16,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  gtao.blendIntensity = 0.9;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());

  const setSize = (w, h) => {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    gtao.setSize(w, h);
  };

  // Free the IBL prefilter chain, post chain, and shadow-catcher on unmount.
  const disposeStage = () => {
    composer.dispose();
    gtao.dispose();
    envTarget.dispose();
    pmrem.dispose();
    roomEnv.dispose?.();
    ground.geometry.dispose();
    ground.material.dispose();
  };

  return { scene, camera, renderer, controls, composer, setSize, disposeStage };
};

/**
 * Mount a VRM vessel into containerRef and run it until unmount.
 * @param {{current: HTMLElement|null}} containerRef
 * @param {string|null} modelUrl - model URL to load; null mounts nothing
 *   (the caller decides which held vessel to wear — vessel-roster.js)
 * @param {{speaking: boolean, emotion: string|null, emotionId: string|null}|null} signals
 *   live face signals (vessel-signals.js); read each frame via a ref so signal
 *   changes never rebuild the stage
 * @returns {'loading'|'ready'|'error'} stage status
 */
// impure
export const useVrmStage = (containerRef, modelUrl, signals = null) => {
  const [status, setStatus] = useState('loading');
  const signalsRef = useRef(signals);
  signalsRef.current = signals;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !modelUrl) return undefined;

    setStatus('loading'); // a vessel switch rebuilds the stage from scratch
    const url = modelUrl;
    const canvas = document.createElement('canvas');
    canvas.className = 'vessel-canvas';
    container.appendChild(canvas);

    const { scene, camera, renderer, controls, composer, setSize, disposeStage } = buildStage(canvas);
    const clock = new THREE.Clock();
    let vrm = null;
    let mixer = null;
    let driver = null; // expression driver (null until load / for faceless vessels)
    let appliedEmotionId = null;
    let animating = false; // a retargeted clip is driving the pose
    let raf = 0;
    let disposed = false;

    const sizeToContainer = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      setSize(w, h);
    };

    const observer = new ResizeObserver(sizeToContainer);
    observer.observe(container);
    sizeToContainer();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const delta = clock.getDelta();
      // Window-shade collapses the body to zero height — skip the draw entirely.
      if (container.clientHeight === 0) return;
      controls.update();
      if (mixer) mixer.update(delta);
      if (vrm) {
        if (!animating) applyIdleBreath(vrm, clock.elapsedTime);
        if (driver) {
          const live = signalsRef.current;
          if (live) driver.setSpeaking(live.speaking);
          const next = decideEmotionApply(live, appliedEmotionId);
          if (next.apply) {
            appliedEmotionId = next.appliedEmotionId;
            driver.setEmotion(next.emotion);
          }
          driver.update(delta);
        }
        vrm.update(delta);
      }
      composer.render(delta);
    };

    // Load the idle clip and start it looping (non-blocking; the breath covers
    // the gap and stays as the fallback if the clip can't load/retarget).
    const startIdle = () => {
      new BVHLoader().loadAsync(IDLE_URL).then((result) => {
        if (disposed || !vrm) return;
        mixer = new THREE.AnimationMixer(vrm.scene);
        const action = mixer.clipAction(retargetBVH(result, vrm, 'idle'));
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        animating = true;
      }).catch(() => { /* breath fallback stays */ });
    };

    const loader = createVesselLoader();
    loader.loadAsync(url)
      .then((gltf) => {
        if (disposed) return;
        vrm = gltf.userData.vrm;
        VRMUtils.rotateVRM0(vrm);
        // The vessel casts (onto the contact-shadow catcher) and self-receives —
        // required for the shadow pass to see it at all.
        vrm.scene.traverse((o) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
        scene.add(vrm.scene);
        driver = createExpressionDriver(vrm);
        setStatus('ready');
        startIdle();
        loop();
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      if (mixer) {
        mixer.stopAllAction();
        if (vrm) mixer.uncacheRoot(vrm.scene);
      }
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      disposeStage();
      renderer.dispose();
      canvas.remove();
    };
  }, [containerRef, modelUrl]);

  return status;
};
