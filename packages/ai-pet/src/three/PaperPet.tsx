import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PaperPetMode } from '../paperPet';

interface PaperPetProps {
  paper: THREE.Texture;
  wood: THREE.Texture;
  wallFrontZ: number;
  mode: PaperPetMode;
  panelOpen: boolean;
  interactive: boolean;
  enabled: boolean;
  onWake: () => void;
  trigger: ReactNode;
  reply: ReactNode;
  greeting: ReactNode;
  replyPortal: RefObject<HTMLDivElement | null>;
  onNoteOpen?: () => void;
}

function extrude(points: [number, number][], depth: number, bevel: number) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 1, steps: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function foldedBox(width: number, height: number, depth: number, corner: number) {
  const x = width / 2;
  const y = height / 2;
  return extrude([[-x + corner, -y], [x - corner, -y], [x, -y + corner], [x, y - corner],
    [x - corner, y], [-x + corner, y], [-x, y - corner], [-x, -y + corner]], depth, 0.014);
}

function createAssets(source: THREE.Texture, wood: THREE.Texture) {
  const paper = source.clone();
  paper.repeat.set(0.85, 0.85);
  paper.colorSpace = THREE.SRGBColorSpace;
  paper.needsUpdate = true;
  // A squat paper creature: stepped corners, short legs, no logo or terminal screen.
  const head = extrude([
    [-0.4, -0.24], [0.4, -0.24], [0.44, -0.2], [0.44, 0.18],
    [0.35, 0.18], [0.35, 0.28], [-0.35, 0.28], [-0.35, 0.18],
    [-0.44, 0.18], [-0.44, -0.2],
  ], 0.4, 0.018);
  const arm = foldedBox(0.14, 0.22, 0.2, 0.018);
  const foot = foldedBox(0.13, 0.2, 0.22, 0.018);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const circle = new THREE.CircleGeometry(1, 24);
  const geometries = { head, arm, foot, box, circle };
  const edges = { head: new THREE.EdgesGeometry(head, 28),
    arm: new THREE.EdgesGeometry(arm, 28), foot: new THREE.EdgesGeometry(foot, 28), box: new THREE.EdgesGeometry(box) };
  const materials = {
    paper: new THREE.MeshStandardMaterial({ map: paper, color: '#d4d0bf', roughness: 1, flatShading: true }),
    ink: new THREE.MeshBasicMaterial({ color: '#484a43' }),
    fold: new THREE.MeshBasicMaterial({ color: '#85867a', transparent: true, opacity: 0.45 }),
    wood: new THREE.MeshBasicMaterial({ map: wood, color: '#cecdc5' }),
    edge: new THREE.LineBasicMaterial({ color: '#76776b', transparent: true, opacity: 0.6 }),
    woodEdge: new THREE.LineBasicMaterial({ color: '#65675e', transparent: true, opacity: 0.65 }),
    shadow: new THREE.MeshBasicMaterial({ color: '#444d46', transparent: true, opacity: 0.15, depthWrite: false }),
  };
  return { geometries, edges, materials, dispose() {
    Object.values(geometries).forEach((geometry) => geometry.dispose());
    Object.values(edges).forEach((geometry) => geometry.dispose());
    Object.values(materials).forEach((material) => material.dispose());
    paper.dispose();
  } };
}

type Assets = ReturnType<typeof createAssets>;

function PaperPiece({ assets, part }: { assets: Assets; part: 'head' | 'arm' | 'foot' }) {
  return <>
    <mesh geometry={assets.geometries[part]} material={assets.materials.paper} />
    <lineSegments geometry={assets.edges[part]} material={assets.materials.edge} raycast={() => {}} />
  </>;
}

function Stroke({ assets, x, y, width, angle = 0, folded = false }: {
  assets: Assets; x: number; y: number; width: number; angle?: number; folded?: boolean;
}) {
  return <mesh geometry={assets.geometries.box} material={folded ? assets.materials.fold : assets.materials.ink}
    position={[x, y, 0]} rotation-z={angle} scale={[width, folded ? 0.005 : 0.022, 0.005]} />;
}

/** A solid folded-paper companion; all motion is local to the shelf, never the camera. */
export default function PaperPet({ paper, wood, wallFrontZ, mode, panelOpen, interactive, enabled, onWake, trigger, reply, greeting, replyPortal }: PaperPetProps) {
  const assets = useMemo(() => createAssets(paper, wood), [paper, wood]);
  const pet = useRef<THREE.Group>(null);
  const cameraLocal = useMemo(() => new THREE.Vector3(), []);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const face = useRef<THREE.Group>(null);
  const motion = useRef({ time: 0, age: 0, reduced: false, hover: false });

  useEffect(() => () => assets.dispose(), [assets]);
  useEffect(() => { motion.current.age = 0; }, [mode]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { motion.current.reduced = preference.matches; };
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (!interactive && motion.current.hover) {
      document.body.style.cursor = 'auto';
      motion.current.hover = false;
    }
    return () => { if (motion.current.hover) document.body.style.cursor = 'auto'; };
  }, [interactive]);

  useFrame(({ camera }, frameDelta) => {
    if (!enabled || !body.current || !head.current || !leftArm.current || !rightArm.current || !face.current) return;
    // Face the viewer from the left side of the scene; yaw only keeps the feet on the shelf.
    if (pet.current?.parent) {
      camera.getWorldPosition(cameraLocal);
      pet.current.parent.worldToLocal(cameraLocal);
      pet.current.rotation.y = Math.atan2(cameraLocal.x - pet.current.position.x, cameraLocal.z - pet.current.position.z);
    }
    const current = motion.current;
    const delta = Math.min(frameDelta, 0.05);
    current.age += delta;
    current.time += delta;
    const t = current.reduced ? 0 : current.time;
    const waking = mode === 'waking';
    const thinking = mode === 'thinking';
    const talking = mode === 'answering';
    const breath = current.reduced ? 0 : Math.sin(t * 2.2);
    const wave = current.reduced ? 0 : Math.sin(current.age * 13);
    const blend = current.reduced ? 1 : 1 - Math.exp(-delta * 9);
    body.current.position.y = THREE.MathUtils.lerp(body.current.position.y, breath * 0.012, blend);
    body.current.rotation.z = 0;
    head.current.rotation.set(0, 0, 0);
    leftArm.current.rotation.z = THREE.MathUtils.lerp(leftArm.current.rotation.z, waking ? -1.9 : -0.3, blend);
    rightArm.current.rotation.z = THREE.MathUtils.lerp(rightArm.current.rotation.z, waking ? 2.05 + wave * 0.27 : thinking ? 1.0 : talking ? 0.6 + breath * 0.2 : 0.28, blend);
    face.current.scale.y = !current.reduced && t % 5.3 > 5.15 ? 0.12 : 1;
  });

  const activate = (event: ThreeEvent<MouseEvent>) => {
    if (!interactive || event.delta > 6) return;
    event.stopPropagation();
    onWake();
  };

  // Lower the whole shelf assembly slightly so the plank's top face remains visible beneath the feet.
  return (
    <group name="paper-pet-shelf" visible={enabled} position={[-2.3, 0, wallFrontZ + 0.31]} dispose={null}>
      {/* A floating solid plank, with its rear edge flush with the wall. */}
      <mesh name="paper-pet-plank" geometry={assets.geometries.box} material={assets.materials.wood} scale={[1.7, 0.095, 0.6]} />
      <lineSegments geometry={assets.edges.box} material={assets.materials.woodEdge} scale={[1.7, 0.095, 0.6]} raycast={() => {}} />
      <mesh geometry={assets.geometries.circle} material={assets.materials.shadow}
        position={[0, 0.05, 0.025]} rotation-x={-Math.PI / 2} scale={[0.28, 0.16, 1]} />
      <group ref={pet} position={[0, 0.13, 0.015]} scale={0.72} name="paper-pet" onClick={activate}
        onPointerOver={(event) => {
          if (!interactive) return;
          event.stopPropagation();
          motion.current.hover = true;
          document.body.style.cursor = 'pointer';
        }} onPointerOut={() => {
          if (motion.current.hover) document.body.style.cursor = 'auto';
          motion.current.hover = false;
        }}>
        {[-0.27, 0.27].flatMap((x) => [-0.13, 0.16].map((z) => (
          <group key={`${x}:${z}`} position={[x, 0, z]}><PaperPiece assets={assets} part="foot" /></group>
        )))}
        <group ref={body} name="paper-pet-body">
          <group ref={leftArm} position={[-0.46, 0.29, 0]}><group position={[0, -0.07, 0]}><PaperPiece assets={assets} part="arm" /></group></group>
          <group ref={rightArm} position={[0.46, 0.29, 0]}><group position={[0, -0.07, 0]}><PaperPiece assets={assets} part="arm" /></group></group>
          <group ref={head} position={[0, 0.33, 0]} name="paper-pet-head">
            <PaperPiece assets={assets} part="head" />
            <group position={[0, 0, 0.22]}>
              <Stroke assets={assets} x={-0.345} y={-0.175} width={0.095} angle={-0.8} folded />
              <Stroke assets={assets} x={0.305} y={0.145} width={0.1} angle={-0.8} folded />
            </group>
            <group ref={face} position={[0, -0.015, 0.225]}>
              <group>
                {[-0.15, 0.15].map((x) => <mesh key={x} geometry={assets.geometries.box} material={assets.materials.ink}
                  position={[x, mode === 'thinking' ? 0.04 : 0.01, 0]} scale={[0.055, 0.095, 0.006]} />)}
              </group>
            </group>
          </group>
        </group>
      </group>
      {/* HTML must explicitly unmount: Three.Group.visible cannot hide DOM. */}
      {enabled && interactive && <Html center position={[0, 0.36, 0.37]} zIndexRange={[6, 5]}>{trigger}</Html>}
      {enabled && interactive && !panelOpen && greeting && <Html center position={[0, 1.05, 0.34]} zIndexRange={[24, 23]}>{greeting}</Html>}
      {enabled && interactive && panelOpen && <Html portal={replyPortal.current ? { current: replyPortal.current } : undefined}
        wrapperClass="paper-pet-reply-anchor" position={[0, 0.73, 0.34]} zIndexRange={[25, 24]}>{reply}</Html>}
    </group>
  );
}
