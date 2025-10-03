import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let earth, sun;
let meteors = [], impactEffects = [];
let cursor;
let asteroidList = [];
let simSpeed = 1;
import './src/app.js';
// Realistic physics constants (SI-ish, scene scaled)
