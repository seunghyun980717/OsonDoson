import * as THREE from 'three';

export type MorphMesh = THREE.Mesh & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

export type AvatarRigState = {
  bindRotations: Map<string, THREE.Quaternion>;
  bindWorldPositions?: Map<string, THREE.Vector3>;
  bindWorldQuaternions?: Map<string, THREE.Quaternion>;
  bindMorphValues?: Record<string, number>;
  boneAliases?: Record<string, string>;
  bones: Map<string, THREE.Bone>;
  morphAliases?: Record<string, string>;
  morphMeshes: MorphMesh[];
  morphValues: Record<string, number>;
  supportedMorphNames: Set<string>;
};

export type ApplyBoneQuaternion = (
  name: string,
  targetQuaternion: THREE.Quaternion,
  smoothing?: number,
) => void;

export type MissingAliasReport = {
  missingBones: Array<[string, string]>;
  missingMorphs: Array<[string, string]>;
};

export const createRigController = (avatarState: AvatarRigState) => {
  const normalizeRuntimeName = (name: string) => name.replaceAll('.', '');

  const aliasEntriesForActual = (
    aliasMap: Record<string, string> | undefined,
    actualName: string,
  ): Array<[string, string]> => {
    const normalizedActualName = normalizeRuntimeName(actualName);

    return Object.entries(aliasMap ?? {}).filter(([, targetName]) => (
      targetName === actualName || normalizeRuntimeName(targetName) === normalizedActualName
    ));
  };

  const resolveMorphName = (name: string) => {
    const aliasTarget = avatarState.morphAliases?.[name];

    if (aliasTarget && avatarState.supportedMorphNames.has(aliasTarget)) {
      return aliasTarget;
    }

    return name;
  };

  const ensureBindMorphValues = () => {
    avatarState.bindMorphValues ??= {};
    return avatarState.bindMorphValues;
  };

  const rememberBone = (bone: THREE.Bone) => {
    avatarState.bones.set(bone.name, bone);
    avatarState.bindRotations.set(bone.name, bone.quaternion.clone());

    aliasEntriesForActual(avatarState.boneAliases, bone.name).forEach(([aliasName]) => {
      avatarState.bones.set(aliasName, bone);
      avatarState.bindRotations.set(aliasName, bone.quaternion.clone());
    });
  };

  const rememberMorphMesh = (mesh: MorphMesh) => {
    if (!avatarState.morphMeshes.includes(mesh)) {
      avatarState.morphMeshes.push(mesh);
    }

    const bindMorphValues = ensureBindMorphValues();

    Object.entries(mesh.morphTargetDictionary ?? {}).forEach(([name, index]) => {
      avatarState.supportedMorphNames.add(name);

      const initialValue = Number(mesh.morphTargetInfluences?.[index]) || 0;
      bindMorphValues[name] = initialValue;
      avatarState.morphValues[name] = initialValue;

      aliasEntriesForActual(avatarState.morphAliases, name).forEach(([aliasName]) => {
        avatarState.supportedMorphNames.add(aliasName);
        bindMorphValues[aliasName] = initialValue;
        avatarState.morphValues[aliasName] = initialValue;
      });
    });
  };

  const captureBindPose = (root: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    avatarState.bindWorldPositions = new Map();
    avatarState.bindWorldQuaternions = new Map();

    avatarState.bones.forEach((bone, name) => {
      avatarState.bindWorldPositions?.set(name, bone.getWorldPosition(new THREE.Vector3()));
      avatarState.bindWorldQuaternions?.set(name, bone.getWorldQuaternion(new THREE.Quaternion()));
    });
  };

  const applyBoneQuaternion: ApplyBoneQuaternion = (name, targetQuaternion, smoothing = 1) => {
    const bone = avatarState.bones.get(name);

    if (!bone) {
      return;
    }

    if (smoothing < 1) {
      bone.quaternion.slerp(targetQuaternion, smoothing);
      return;
    }

    bone.quaternion.copy(targetQuaternion);
  };

  const setBoneRotation = (name: string, rotation: THREE.Euler, smoothing = 1) => {
    const bindRotation = avatarState.bindRotations.get(name);

    if (!bindRotation) {
      return;
    }

    const offset = new THREE.Quaternion().setFromEuler(rotation);
    const targetQuaternion = bindRotation.clone().multiply(offset);
    applyBoneQuaternion(name, targetQuaternion, smoothing);
  };

  const setMorphValue = (name: string, value: number, smoothing = 1) => {
    const targetName = resolveMorphName(name);
    const currentValue = avatarState.morphValues[name]
      ?? avatarState.morphValues[targetName]
      ?? 0;
    const nextValue = smoothing < 1
      ? THREE.MathUtils.lerp(currentValue, value, smoothing)
      : value;

    avatarState.morphValues[name] = nextValue;
    avatarState.morphValues[targetName] = nextValue;

    avatarState.morphMeshes.forEach((mesh) => {
      const targetIndex = mesh.morphTargetDictionary?.[targetName];

      if (targetIndex === undefined || !mesh.morphTargetInfluences) {
        return;
      }

      mesh.morphTargetInfluences[targetIndex] = nextValue;
    });
  };

  const applyMorphMap = (morphs: Record<string, number> | null | undefined, smoothing = 1) => {
    if (!morphs) {
      return;
    }

    Object.entries(morphs).forEach(([name, value]) => {
      const targetName = resolveMorphName(name);

      if (
        avatarState.supportedMorphNames.size
        && !avatarState.supportedMorphNames.has(name)
        && !avatarState.supportedMorphNames.has(targetName)
      ) {
        return;
      }

      setMorphValue(name, value, smoothing);
    });
  };

  const resetPose = () => {
    avatarState.bindRotations.forEach((quaternion, name) => {
      const bone = avatarState.bones.get(name);

      if (bone) {
        bone.quaternion.copy(quaternion);
      }
    });

    const bindMorphValues = avatarState.bindMorphValues ?? {};
    const morphNames = new Set([
      ...Object.keys(avatarState.morphValues),
      ...Object.keys(bindMorphValues),
    ]);

    morphNames.forEach((name) => {
      setMorphValue(name, bindMorphValues[name] ?? 0);
    });
  };

  const reportMissingAliases = (): MissingAliasReport => {
    const missingBones = Object.entries(avatarState.boneAliases ?? {})
      .filter(([aliasName]) => !avatarState.bones.has(aliasName));
    const missingMorphs = Object.entries(avatarState.morphAliases ?? {})
      .filter(([aliasName]) => !avatarState.supportedMorphNames.has(aliasName));

    if (missingBones.length) {
      console.warn('Missing bone aliases', missingBones);
    }

    if (missingMorphs.length) {
      console.warn('Missing morph aliases', missingMorphs);
    }

    return {
      missingBones,
      missingMorphs,
    };
  };

  return {
    applyBoneQuaternion,
    applyMorphMap,
    captureBindPose,
    rememberBone,
    rememberMorphMesh,
    reportMissingAliases,
    resetPose,
    setBoneRotation,
    setMorphValue,
  };
};
