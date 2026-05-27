import { Asset } from 'expo-asset';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

import avatarModelAsset from '../../../assets/models/model.glb';

let modelTemplatePromise: Promise<THREE.Group> | null = null;

const resolveAvatarModelUri = async () => {
  const asset = Asset.fromModule(avatarModelAsset);
  await asset.downloadAsync();

  return asset.localUri ?? asset.uri;
};

const loadAvatarModelTemplate = async () => {
  if (!modelTemplatePromise) {
    modelTemplatePromise = resolveAvatarModelUri()
      .then((uri) => {
        const loader = new GLTFLoader();
        return loader.loadAsync(uri);
      })
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

  instance.traverse((object: THREE.Object3D) => {
    if (object instanceof THREE.Mesh) {
      object.material = cloneMaterial(object.material);
    }
  });

  return instance;
};
