declare module 'expo-three' {
  import type { ExpoWebGLRenderingContext } from 'expo-gl';
  import type * as THREE from 'three';

  export class Renderer extends THREE.WebGLRenderer {
    constructor(options: { gl: ExpoWebGLRenderingContext });
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
}

declare module 'three/examples/jsm/utils/SkeletonUtils.js' {
  export { clone } from 'three/examples/jsm/utils/SkeletonUtils';
}

declare module '@/lib/avatar-viewer/lib/head-face-strategies.js';
declare module '@/lib/avatar-viewer/lib/sen-correction.js';
declare module '@/lib/avatar-viewer/viewer/body-motion.js';
declare module '@/lib/avatar-viewer/viewer/face-morph-safety.js';
declare module '@/lib/avatar-viewer/viewer/rig-controller.js';
