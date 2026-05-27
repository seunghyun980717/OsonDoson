import * as THREE from 'three';

export function createRigController(avatarState) {
  function rememberBone(bone) {
    avatarState.bones.set(bone.name, bone);
    avatarState.bindRotations.set(bone.name, bone.quaternion.clone());
  }

  function applyBoneQuaternion(name, targetQuaternion, smoothing = 1) {
    const bone = avatarState.bones.get(name);

    if (!bone) {
      return;
    }

    if (smoothing < 1) {
      bone.quaternion.slerp(targetQuaternion, smoothing);
      return;
    }

    bone.quaternion.copy(targetQuaternion);
  }

  function setBoneRotation(name, rotation, smoothing = 1) {
    const bindRotation = avatarState.bindRotations.get(name);

    if (!bindRotation) {
      return;
    }

    const offset = new THREE.Quaternion().setFromEuler(rotation);
    const targetQuaternion = bindRotation.clone().multiply(offset);
    applyBoneQuaternion(name, targetQuaternion, smoothing);
  }

  function setMorphValue(name, value, smoothing = 1) {
    const currentValue = avatarState.morphValues[name] ?? 0;
    const nextValue = smoothing < 1
      ? THREE.MathUtils.lerp(currentValue, value, smoothing)
      : value;

    avatarState.morphValues[name] = nextValue;

    avatarState.morphMeshes.forEach((mesh) => {
      const targetIndex = mesh.morphTargetDictionary?.[name];

      if (targetIndex === undefined) {
        return;
      }

      mesh.morphTargetInfluences[targetIndex] = nextValue;
    });
  }

  function applyMorphMap(morphs, smoothing = 1) {
    if (!morphs) {
      return;
    }

    Object.entries(morphs).forEach(([name, value]) => {
      if (avatarState.supportedMorphNames.size && !avatarState.supportedMorphNames.has(name)) {
        return;
      }

      setMorphValue(name, value, smoothing);
    });
  }

  function resetPose() {
    avatarState.waving = false;

    avatarState.bindRotations.forEach((quaternion, name) => {
      const bone = avatarState.bones.get(name);

      if (bone) {
        bone.quaternion.copy(quaternion);
      }
    });

    Object.keys(avatarState.morphValues).forEach((name) => {
      setMorphValue(name, 0);
    });
  }

  return {
    applyBoneQuaternion,
    applyMorphMap,
    rememberBone,
    resetPose,
    setBoneRotation,
    setMorphValue,
  };
}
