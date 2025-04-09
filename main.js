// --- DOM Element Selection ---
const canvas = document.getElementById('renderCanvas');
const infoElement = document.getElementById('info');
const statusElement = document.getElementById('status');
const crosshairElement = document.getElementById('crosshair');

// --- Global Variables ---
let engine = null;
let scene = null;
let isPointerLocked = false;
let ground = null;
let playerCamera = null;
let xrHelper = null;

// --- Engine Initialization ---
try {
    // This line should no longer cause "BABYLON is not defined"
    // because main.js is now deferred until babylon.min.js runs.
    engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: true, stencil: true, antialias: true
    });
} catch (e) {
    console.error("Babylon Engine initialization failed", e);
    alert("Could not initialize the 3D engine. Your browser may not be supported.");
    throw e; // Stop execution
}

// --- Scene Creation Function (Async) ---
const createScene = async () => {
    console.log("Creating scene...");
    statusElement.innerText = "Creating Scene...";
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);

    // --- Physics Engine Setup (Using Havok) ---
    const gravityVector = new BABYLON.Vector3(0, -9.81, 0);
    let physicsPlugin;
    try {
        statusElement.innerText = "Initializing Physics...";
        console.log("Initializing Havok Physics...");
        const havokInstance = await HavokPhysics(); // Global from UMD script
        physicsPlugin = new BABYLON.HavokPlugin(true, havokInstance);
        scene.enablePhysics(gravityVector, physicsPlugin);
        console.log("Physics enabled with Havok.");
    } catch (error) {
        console.error("Failed to initialize Havok Physics:", error);
        statusElement.innerText = "Physics Init Failed!";
        alert("Failed to initialize Havok Physics. Check console for details.");
        return null; // Indicate failure
    }


    // --- Camera (FPS Style - UniversalCamera) ---
    playerCamera = new BABYLON.UniversalCamera("playerCamera", new BABYLON.Vector3(0, 2.5, -10), scene);
    playerCamera.attachControl(canvas, true);
    playerCamera.speed = 0.5;
    playerCamera.angularSensibility = 3500;
    playerCamera.inertia = 0.1;
    playerCamera.cameraRotation = new BABYLON.Vector2(0, 0);
    playerCamera.keysUp.push(87); // W
    playerCamera.keysDown.push(83); // S
    playerCamera.keysLeft.push(65); // A
    playerCamera.keysRight.push(68); // D

    // --- Player Physics & Collision Settings ---
    playerCamera.checkCollisions = true;
    playerCamera.applyGravity = true;
    playerCamera.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5);
    playerCamera.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0);
    playerCamera.collisionMask = 1;


    // --- Environment Preset ---
    console.log("Creating default environment...");
    statusElement.innerText = "Loading Environment...";
    let environmentHelper = null;
    try {
        environmentHelper = scene.createDefaultEnvironment({
            createSkybox: true,
            skyboxTexture: "https://assets.babylonjs.com/environments/environmentSpecular.env",
            skyboxColor: new BABYLON.Color3(0.1, 0.1, 0.2),
            skyboxSize: 200, createGround: true, groundSize: 100,
            groundColor: new BABYLON.Color3(0.5, 0.55, 0.5),
            enableGroundShadow: true, groundYBias: 0.01
        });
        if (environmentHelper) {
            environmentHelper.setMainColor(new BABYLON.Color3(0.85, 0.85, 0.85));
            if (environmentHelper.ground) {
                ground = environmentHelper.ground; ground.name = "environmentGround";
                ground.checkCollisions = true; ground.receiveShadows = true;
                if (!ground.material) {
                    console.warn("Environment ground created without a material. Assigning fallback.");
                    let groundMat = new BABYLON.StandardMaterial("envGroundMat", scene);
                    groundMat.diffuseColor = new BABYLON.Color3(0.5, 0.55, 0.5); groundMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
                    ground.material = groundMat;
                } else { ground.material.alpha = 1.0; console.log("Environment ground material found:", ground.material.name); }
                ground.physicsImpostor = new BABYLON.PhysicsImpostor( ground, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, restitution: 0.1, friction: 0.8 }, scene );
                console.log("Environment ground created and configured for physics.");
            } else { throw new Error("Environment helper created but ground is missing."); }
        } else { throw new Error("createDefaultEnvironment returned null."); }
    } catch (envError) {
        console.error("Error creating default environment:", envError); statusElement.innerText = "Env Error. Using Fallback."; scene.createDefaultLight();
        if (!ground) {
            ground = BABYLON.MeshBuilder.CreateGround("errorFallbackGround", { width: 100, height: 100 }, scene);
            let fallbackMat = new BABYLON.StandardMaterial("fallbackGroundMat", scene); fallbackMat.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6); ground.material = fallbackMat;
            ground.physicsImpostor = new BABYLON.PhysicsImpostor(ground, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, restitution: 0.1 }, scene);
            ground.checkCollisions = true; ground.receiveShadows = true; console.log("Created fallback ground due to environment error.");
        }
    }


    // --- Enhanced Lighting (Sun for Shadows) ---
    const dirLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-0.6, -1, -0.4).normalize(), scene);
    dirLight.position = new BABYLON.Vector3(50, 80, 40); dirLight.intensity = 1.2; dirLight.shadowMinZ = 1; dirLight.shadowMaxZ = 150;
    const shadowGenerator = new BABYLON.ShadowGenerator(2048, dirLight);
    shadowGenerator.useBlurExponentialShadowMap = true; shadowGenerator.blurKernel = 32; shadowGenerator.setDarkness(0.4); shadowGenerator.forceBackFacesOnly = true; shadowGenerator.bias = 0.005;
    dirLight.shadowEnabled = true;
    if (ground) { ground.receiveShadows = true; }


    // --- Dynamic Physics Objects ---
    console.log("Adding dynamic objects...");
    statusElement.innerText = "Adding Objects...";
    const sphereMaterial = new BABYLON.StandardMaterial("sphereMat", scene); sphereMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.4, 0.4); sphereMaterial.specularPower = 32;
    const boxMaterial = new BABYLON.StandardMaterial("boxMat", scene); boxMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.9); boxMaterial.specularPower = 32;
    const commonPhysicsProps = { restitution: 0.4, friction: 0.6 }; const objectCount = 25;
    for (let i = 0; i < objectCount; i++) {
        const type = Math.random() < 0.5 ? 'sphere' : 'box'; const size = 0.8 + Math.random() * 1.8;
        const position = new BABYLON.Vector3((Math.random() - 0.5) * 70, 8 + Math.random() * 12, (Math.random() - 0.5) * 70);
        let mesh; let impostorType;
        if (type === 'sphere') { mesh = BABYLON.MeshBuilder.CreateSphere(`sphere${i}`, { diameter: size }, scene); mesh.material = sphereMaterial; impostorType = BABYLON.PhysicsImpostor.SphereImpostor; }
        else { mesh = BABYLON.MeshBuilder.CreateBox(`box${i}`, { size: size }, scene); mesh.material = boxMaterial; mesh.rotation.x = Math.random() * Math.PI; mesh.rotation.y = Math.random() * Math.PI; impostorType = BABYLON.PhysicsImpostor.BoxImpostor; }
        mesh.position = position; mesh.checkCollisions = true;
        mesh.physicsImpostor = new BABYLON.PhysicsImpostor(mesh, impostorType, { mass: size * 1.2, ...commonPhysicsProps }, scene);
        if (shadowGenerator) { shadowGenerator.addShadowCaster(mesh, true); }
    }
    console.log(`${objectCount} dynamic objects added.`);


    // --- WebXR Experience ---
    console.log("Attempting to initialize WebXR...");
    statusElement.innerText = "Initializing WebXR...";
    xrHelper = null;
    if (navigator.xr) {
        try {
            xrHelper = await scene.createDefaultXRExperienceAsync({ floorMeshes: ground ? [ground] : [], disableTeleportation: true, });
            if (xrHelper && xrHelper.baseExperience) {
                console.log("WebXR Experience Helper created successfully."); statusElement.innerText = "WebXR Ready!";
                xrHelper.baseExperience.onStateChangedObservable.add((state) => { /* ... */ });
                if (xrHelper.baseExperience.onInitialCameraReadyObservable) { xrHelper.baseExperience.onInitialCameraReadyObservable.addOnce((xrCamera) => { /* ... */ }); }
                 else { console.warn("onInitialCameraReadyObservable not found on baseExperience."); }
            } else { console.warn("WebXR Base Experience could not be initialized."); statusElement.innerText = "WebXR Failed (Check HTTPS/Device)"; }
        } catch (xrError) {
            console.error("Error during WebXR initialization:", xrError); statusElement.innerText = `WebXR Error: ${xrError.message}`;
            const errorDiv = document.createElement('div'); errorDiv.style.color = 'red'; errorDiv.style.marginTop = '10px'; errorDiv.innerHTML = `<b>WebXR Error:</b> ${xrError.message}`; infoElement.appendChild(errorDiv);
        }
    } else { console.warn("WebXR is not supported by this browser/device."); statusElement.innerText = "WebXR Not Supported"; }

    setupControls(); // Setup pointer lock and jump listeners

    console.log("Scene creation complete.");
    return scene;
}; // --- End of createScene ---


// --- Control Setup Function ---
const setupControls = () => {
    // --- Pointer Lock ---
    scene.onPointerDown = (evt) => { const isInVR = xrHelper && xrHelper.baseExperience && xrHelper.baseExperience.state === BABYLON.WebXRState.IN_XR; if (evt.button === 0 && !isPointerLocked && !isInVR) { canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock; if (canvas.requestPointerLock) { canvas.requestPointerLock(); } else { console.warn("Pointer Lock API not available."); } } };
    const pointerLockChange = () => { const element = document.pointerLockElement || document.mozPointerLockElement || document.webkitPointerLockElement; const isInVR = xrHelper && xrHelper.baseExperience && xrHelper.baseExperience.state === BABYLON.WebXRState.IN_XR; if (element === canvas && !isInVR) { isPointerLocked = true; infoElement.style.display = 'none'; crosshairElement.style.display = 'block'; console.log("Pointer locked."); } else { isPointerLocked = false; if (!isInVR) { infoElement.style.display = 'block'; } else { infoElement.style.display = 'none'; } crosshairElement.style.display = 'none'; console.log("Pointer unlocked or in VR."); } };
    document.addEventListener("pointerlockchange", pointerLockChange, false); document.addEventListener("mozpointerlockchange", pointerLockChange, false); document.addEventListener("webkitpointerlockchange", pointerLockChange, false);

    // --- Jump Mechanic ---
    const jumpVelocity = 5.5; let canJump = true; const jumpCooldown = 700;
    scene.onKeyboardObservable.add((kbInfo) => {
        if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN && kbInfo.event.code === "Space" && canJump) {
            if (playerCamera && ground) {
                const rayStart = playerCamera.position.subtract(new BABYLON.Vector3(0, playerCamera.ellipsoid.y * 0.9, 0));
                const rayLength = playerCamera.ellipsoid.y * 1.1;
                const ray = new BABYLON.Ray(rayStart, new BABYLON.Vector3(0, -1, 0), rayLength);
                const pickInfo = scene.pickWithRay(ray, (mesh) => mesh === ground || (mesh.isPickable && mesh.physicsImpostor && mesh.physicsImpostor.mass > 0));
                if (pickInfo && pickInfo.hit && pickInfo.distance < rayLength) {
                    console.log("Jump initiated! (Applying impulse via cameraDirection - May need tuning for Havok)");
                    playerCamera.cameraDirection.y = jumpVelocity;
                    canJump = false;
                    setTimeout(() => { canJump = true; }, jumpCooldown);
                }
            }
        }
    });

    console.log("Controls initialized.");
};


// --- Main Execution Logic ---
(async () => {
    try {
        const createdScene = await createScene(); // Wait for scene creation

        if (!createdScene) {
             console.error("Scene creation failed. Cannot start render loop.");
             statusElement.innerText = "Scene Init Failed!";
             return; // Stop execution
        }

        console.log("Starting render loop.");
        engine.runRenderLoop(() => {
            if (scene) { // Ensure scene exists
               scene.render();
            }
        });

        window.addEventListener('resize', () => {
            if (engine) { // Ensure engine exists
               engine.resize();
            }
        });

    } catch (e) {
        console.error("Fatal error during initialization or scene creation:", e);
        statusElement.innerText = `FATAL ERROR: ${e.message}`;
        alert(`Failed to initialize: ${e.message}\nCheck the browser console.`);
    }
})();
