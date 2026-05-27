import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const AVATAR_MODEL_URL = '/models/model.glb';

let modelTemplatePromise: Promise<THREE.Group> | null = null;

const loadAvatarModelTemplate = async () => {
  if (!modelTemplatePromise) {
    const loader = new GLTFLoader();

    modelTemplatePromise = loader.loadAsync(AVATAR_MODEL_URL)
      .then((gltf) => gltf.scene)
      .catch((error: unknown) => {
        modelTemplatePromise = null;
        throw error;
      });
  }

  return modelTemplatePromise;
};

const cloneMaterial = (material: THREE.Material | THREE.Material[]) => {
  if (Array.isArray(material)) {
    return material.map((item) => item.clone());
  }

  return material.clone();
};

export const preloadAvatarModel = async () => {
  await loadAvatarModelTemplate();
};

export const createAvatarModelInstance = async () => {
  const template = await loadAvatarModelTemplate();
  const instance = cloneSkeleton(template);

  instance.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.material = cloneMaterial(object.material);
    }
  });

  return instance;
};
