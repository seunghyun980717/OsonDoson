import * as THREE from 'three';

export function createRigController(avatarState) {
  function aliasEntriesForActual(aliasMap, actualName) {
    return Object.entries(aliasMap ?? {}).filter(([, targetName]) => targetName === actualName);
  }

  function rememberBone(bone) {
    avatarState.bones.set(bone.name, bone);
    avatarState.bindPositions.set(bone.name, bone.position.clone());
    avatarState.bindRotations.set(bone.name, bone.quaternion.clone());

    aliasEntriesForActual(avatarState.boneAliases, bone.name).forEach(([aliasName]) => {
      avatarState.bones.set(aliasName, bone);
      avatarState.bindPositions.set(aliasName, bone.position.clone());
      avatarState.bindRotations.set(aliasName, bone.quaternion.clone());
    });
  }

  function rememberMorphMesh(mesh) {
    avatarState.morphMeshes.push(mesh);

    Object.entries(mesh.morphTargetDictionary ?? {}).forEach(([name, index]) => {
      avatarState.supportedMorphNames.add(name);
      const initialValue = Number(mesh.morphTargetInfluences?.[index]) || 0;
      avatarState.bindMorphValues[name] = initialValue;
      avatarState.morphValues[name] = initialValue;

      aliasEntriesForActual(avatarState.morphAliases, name).forEach(([aliasName]) => {
        avatarState.supportedMorphNames.add(aliasName);
        avatarState.bindMorphValues[aliasName] = initialValue;
        avatarState.morphValues[aliasName] = initialValue;
      });
    });
  }

  function captureBindPose(root) {
    root.updateMatrixWorld(true);
    avatarState.bindWorldPositions = new Map();
    avatarState.bindWorldQuaternions = new Map();

    avatarState.bones.forEach((bone, name) => {
      avatarState.bindWorldPositions.set(name, bone.getWorldPosition(new THREE.Vector3()));
      avatarState.bindWorldQuaternions.set(name, bone.getWorldQuaternion(new THREE.Quaternion()));
    });
  }

  function resolveMorphName(name) {
    const aliasTarget = avatarState.morphAliases?.[name];
    if (aliasTarget && avatarState.supportedMorphNames.has(aliasTarget)) {
      return aliasTarget;
    }

    return name;
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

  function setBonePositionOffset(name, offset, smoothing = 1) {
    const bone = avatarState.bones.get(name);
    const bindPosition = avatarState.bindPositions.get(name);

    if (!bone || !bindPosition) {
      return;
    }

    const targetPosition = bindPosition.clone().add(offset);

    if (smoothing < 1) {
      bone.position.lerp(targetPosition, smoothing);
      return;
    }

    bone.position.copy(targetPosition);
  }

  function setMorphValue(name, value, smoothing = 1) {
    const targetName = resolveMorphName(name);
    const currentValue = avatarState.morphValues[name] ?? 0;
    const nextValue = smoothing < 1
      ? THREE.MathUtils.lerp(currentValue, value, smoothing)
      : value;

    avatarState.morphValues[name] = nextValue;
    avatarState.morphValues[targetName] = nextValue;

    avatarState.morphMeshes.forEach((mesh) => {
      const targetIndex = mesh.morphTargetDictionary?.[targetName];

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
  }

  function resetPose() {
    avatarState.waving = false;

    avatarState.bindRotations.forEach((quaternion, name) => {
      const bone = avatarState.bones.get(name);

      if (bone) {
        bone.quaternion.copy(quaternion);
      }
    });
    avatarState.bindPositions.forEach((position, name) => {
      const bone = avatarState.bones.get(name);

      if (bone) {
        bone.position.copy(position);
      }
    });

    Object.keys(avatarState.morphValues).forEach((name) => {
      setMorphValue(name, avatarState.bindMorphValues?.[name] ?? 0);
    });
  }

  function reportMissingAliases() {
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
  }

  return {
    applyBoneQuaternion,
    applyMorphMap,
    captureBindPose,
    rememberBone,
    rememberMorphMesh,
    reportMissingAliases,
    resetPose,
    setBonePositionOffset,
    setBoneRotation,
    setMorphValue,
  };
}
