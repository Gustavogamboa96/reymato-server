import { Room, Client } from "colyseus";
import { GameState, PlayerState } from "./GameState";
import * as CANNON from "cannon-es";

interface InputMessage {
  type: "input";
  move: [number, number];
  jump: boolean;
  action: "kick" | "head" | "serve" | null;
}

interface JoinOptions {
  nickname?: string;
}

export class ReyMatoRoom extends Room<GameState> {
  private world!: CANNON.World;
  private readonly playerBodies: Map<string, CANNON.Body> = new Map();
  private ballBody!: CANNON.Body;
  private groundBody!: CANNON.Body;
  // Per-player extra downward acceleration applied during jumps to shape airtime
  private readonly playerJumpExtraG: Map<string, number> = new Map();
  // Materials to control collision behavior between objects
  private groundMat!: CANNON.Material;
  private ballMat!: CANNON.Material;
  private playerMat!: CANNON.Material;
  private wallMat!: CANNON.Material;
  // Serving: Rey always serves; target quadrant cycles Mato -> Rey2 -> Rey1
  private readonly servingTargets: Array<"mato" | "rey2" | "rey1"> = ["mato", "rey2", "rey1"];
  private nextServeTargetIndex = 0;
  private reyStartTime = 0;

  // Court dimensions - larger court for better gameplay
  private readonly COURT_SIZE = 16;
  private readonly BALL_RADIUS = 0.3;
  private readonly PLAYER_RADIUS = 0.4;
  private readonly PLAYER_HEIGHT = 1.8;

  onCreate(options: any) {
    this.setState(new GameState());
    this.setPatchRate(1000 / 30); // 30 FPS

    this.setupPhysics();
    this.setupMessageHandlers();
    this.startGameLoop();
  }

  private setupPhysics() {
    // Create physics world with moderate gravity (good for ball physics)
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -2, 0), // Moderate gravity for good ball physics
    });

    // Create reusable materials
    this.groundMat = new CANNON.Material("ground");
    this.ballMat = new CANNON.Material("ball");
    this.playerMat = new CANNON.Material("player");
    this.wallMat = new CANNON.Material("wall");

    // Ground with low friction
    const groundShape = new CANNON.Plane();
    this.groundBody = new CANNON.Body({ mass: 0 });
    this.groundBody.addShape(groundShape);
    this.groundBody.material = this.groundMat; // Contact materials below will define friction/restitution
    this.groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.world.addBody(this.groundBody);

    // Floating ball physics - slower falling, more hang time, bigger size
    const ballShape = new CANNON.Sphere(0.9); // Even bigger ball for better visibility
    this.ballBody = new CANNON.Body({ mass: 0.12 }); // Even lighter for more floating
    this.ballBody.addShape(ballShape);
    this.ballBody.position.set(0, 2, 0);
    this.ballBody.material = this.ballMat; // Bounciness configured via contact materials
    
    // Higher air resistance for floating effect
    this.ballBody.linearDamping = 0.25; // Maximum air resistance for very slow falling
    this.ballBody.angularDamping = 0.25; // More rotation damping
    
    this.world.addBody(this.ballBody);

    // Create invisible walls around the court to keep ball in bounds
    this.createCourtWalls();

    // Contact materials to fine-tune interactions
    // Ball <-> Ground: bouncy
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.ballMat, this.groundMat, {
      friction: 0.1,
      restitution: 0.8,
    }));
    // Ball <-> Walls: moderately bouncy
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.ballMat, this.wallMat, {
      friction: 0.05,
      restitution: 0.7,
    }));
    // Player <-> Ground: no bounce
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.playerMat, this.groundMat, {
      friction: 0.02,
      restitution: 0,
    }));
    // Player <-> Walls: no bounce
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.playerMat, this.wallMat, {
      friction: 0.05,
      restitution: 0,
    }));

    // Ball collision with ground
    this.ballBody.addEventListener("collide", (e: any) => {
      const other = e.target === this.ballBody ? e.body : e.target;
      
      if (other === this.groundBody) {
        // Boost upward momentum when hitting ground for much more dramatic bounces
        const currentVelY = this.ballBody.velocity.y;
        if (currentVelY < 0) { // Only boost if ball is falling
          this.ballBody.velocity.y = Math.abs(currentVelY) * 2; // Double the bounce from ground
        }
        this.handleBallBounce();
      }
    });
  }

  private createCourtWalls() {
    const wallHeight = 15; // Much taller walls to contain high balls
    const wallThickness = 1; // Thicker walls for better collision
    const halfCourt = this.COURT_SIZE / 2;
    const ceilingHeight = 20; // Height of ceiling
    
    // North wall (positive Z)
    const northWall = new CANNON.Body({ mass: 0 });
    northWall.addShape(new CANNON.Box(new CANNON.Vec3(halfCourt + wallThickness, wallHeight, wallThickness)));
    northWall.position.set(0, wallHeight, halfCourt + wallThickness);
    northWall.material = this.wallMat;
    this.world.addBody(northWall);
    
    // South wall (negative Z)
    const southWall = new CANNON.Body({ mass: 0 });
    southWall.addShape(new CANNON.Box(new CANNON.Vec3(halfCourt + wallThickness, wallHeight, wallThickness)));
    southWall.position.set(0, wallHeight, -halfCourt - wallThickness);
    southWall.material = this.wallMat;
    this.world.addBody(southWall);
    
    // East wall (positive X)
    const eastWall = new CANNON.Body({ mass: 0 });
    eastWall.addShape(new CANNON.Box(new CANNON.Vec3(wallThickness, wallHeight, halfCourt + wallThickness)));
    eastWall.position.set(halfCourt + wallThickness, wallHeight, 0);
    eastWall.material = this.wallMat;
    this.world.addBody(eastWall);
    
    // West wall (negative X)
    const westWall = new CANNON.Body({ mass: 0 });
    westWall.addShape(new CANNON.Box(new CANNON.Vec3(wallThickness, wallHeight, halfCourt + wallThickness)));
    westWall.position.set(-halfCourt - wallThickness, wallHeight, 0);
    westWall.material = this.wallMat;
    this.world.addBody(westWall);
    
    // Ceiling to prevent ball from escaping upward
    const ceiling = new CANNON.Body({ mass: 0 });
    ceiling.addShape(new CANNON.Box(new CANNON.Vec3(halfCourt + wallThickness, wallThickness, halfCourt + wallThickness)));
    ceiling.position.set(0, ceilingHeight, 0);
    ceiling.material = this.wallMat;
    this.world.addBody(ceiling);
  }

  private setupMessageHandlers() {
    this.onMessage("input", (client, message: InputMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.active) return;

      this.handlePlayerInput(client.sessionId, message);
    });

    // Note: Player joining is handled in onJoin method
  }

  private handlePlayerInput(playerId: string, input: InputMessage) {
    const player = this.state.players.get(playerId);
    const playerBody = this.playerBodies.get(playerId);
    
    if (!player || !playerBody) return;

    // Movement - only on X and Z axes
  const [moveX, moveZ] = input.move;
  const speed = 7; // Faster ground/air movement
    playerBody.velocity.x = moveX * speed;
    playerBody.velocity.z = moveZ * speed;
    
    // Allow airtime: do NOT force Y every tick. Only snap to ground when not jumping and close to ground
    const groundY = this.PLAYER_HEIGHT / 2;
    if (!player.jumping && playerBody.position.y <= groundY + 0.05) {
      playerBody.position.y = groundY;
      if (playerBody.velocity.y < 0) playerBody.velocity.y = 0; // stop downward motion on landing
    }
    
    // Boundary checking is handled in updateGameState() to avoid double-clamping
    
    player.vx = playerBody.velocity.x;
    player.vz = playerBody.velocity.z;

    // Jump with higher peak but controlled airtime via extra downward acceleration
    if (input.jump && Math.abs(playerBody.velocity.y) < 0.1) {
      const gWorld = Math.abs(this.world.gravity.y) || 2;
      const targetAirTimeSec = 1.5;
      const desiredV0 = 6; // Higher initial velocity for a real-feel jump apex
      const gEff = (2 * desiredV0) / targetAirTimeSec; // effective gravity to land at ~1.5s
      const extraG = Math.max(0, gEff - gWorld);

      playerBody.velocity.y = desiredV0;
      this.playerJumpExtraG.set(playerId, extraG);
      player.jumping = true;
      
      // Reset jumping flag sooner to allow natural landing snap
      setTimeout(() => {
        if (player) player.jumping = false;
        this.playerJumpExtraG.delete(playerId);
      }, 1500);
    }

    // Actions (kick/head)
    if (input.action) {
      this.handlePlayerAction(playerId, input.action);
    }

    // Keep rotation fixed so joystick always works the same way
    // No auto-rotation based on movement
  }

  private handlePlayerAction(playerId: string, action: "kick" | "head" | "serve") {
    const player = this.state.players.get(playerId);
    const playerBody = this.playerBodies.get(playerId);
    
    if (!player || !playerBody) return;

    // Handle serve action
    if (action === "serve") {
      // Only the current server can serve, and only when waiting for serve
      if (player.role === this.state.currentServer && this.state.waitingForServe) {
        this.performServe(playerId);
      }
      return;
    }

    // Check if ball is close enough for kick/head actions
    const ballPos = this.ballBody.position;
    const playerPos = playerBody.position;
    const distance = ballPos.distanceTo(playerPos);

    if (distance > 1.5) return; // Too far to hit

    // Apply force to ball based on action
    let force: CANNON.Vec3;
    
    if (action === "kick") {
      // Gentle kick toward ball's natural direction
      const ballVel = this.ballBody.velocity;
      let direction: CANNON.Vec3;
      
      if (ballVel.length() > 0.1) {
        // If ball is moving, kick in its direction
        direction = ballVel.clone();
        direction = direction.unit();
      } else {
        // If ball is stationary, kick toward center
        direction = new CANNON.Vec3(-player.x, 0, -player.z);
        direction = direction.unit();
      }
      
      direction.y = 0.3; // More upward component for higher kicks
      direction = direction.unit(); // Normalize again
      force = direction.scale(7); // Increased force for moderate gravity
    } else { // head
      // Only apply header if ball is contacting the player's head area
      // Approximate head world position at the top of the capsule body
      const headY = playerBody.position.y + (this.PLAYER_HEIGHT / 2 - 0.2);
      const headPos = new CANNON.Vec3(playerBody.position.x, headY, playerBody.position.z);
      const dx = this.ballBody.position.x - headPos.x;
      const dy = this.ballBody.position.y - headPos.y;
      const dz = this.ballBody.position.z - headPos.z;
      const horizontalDist = Math.hypot(dx, dz);
      const verticalDist = Math.abs(dy);

      // Contact thresholds: near head horizontally and vertically
      if (horizontalDist > 1.0 || verticalDist > 0.6) {
        return; // Not in head contact range; ignore head action
      }

      // Push the ball away from the head with an upward component
      let dir = new CANNON.Vec3(dx, Math.max(dy, 0.2), dz);
      dir = dir.unit();
      force = dir.scale(7.5);
    }

    this.ballBody.applyImpulse(force, this.ballBody.position);
    this.state.ball.lastTouchedBy = playerId;
    this.state.waitingForServe = false; // No longer waiting for serve after ball is hit
    
    // Broadcast animation to all clients
    this.broadcast("playerAnimation", { playerId, action });
  }

  private performServe(playerId: string) {
    const player = this.state.players.get(playerId);
    if (!player) return;

    // Position ball near the server (Rey)
    const serverX = player.x;
    const serverZ = player.z;
    
    this.ballBody.position.set(serverX, 2, serverZ); // Normal height for beachball
    this.ballBody.velocity.set(0, 0, 0);

    // Determine target based on serving target rotation: Mato -> Rey2 -> Rey1
    const targetRole = this.servingTargets[this.nextServeTargetIndex];
    // advance for next serve
    this.nextServeTargetIndex = (this.nextServeTargetIndex + 1) % this.servingTargets.length;

    let targetX = 0, targetZ = 0;
    switch (targetRole) {
      case "mato":
        targetX = 2.5; targetZ = -2.5; break;
      case "rey2":
        targetX = -2.5; targetZ = -2.5; break;
      case "rey1":
        targetX = -2.5; targetZ = 2.5; break;
    }
    
    const dirX = targetX - serverX;
    const dirZ = targetZ - serverZ;
    const distance = Math.hypot(dirX, dirZ);
    
    // Serve force for floating ball
    const forceScale = 7; // Slightly more force
    const upwardForce = 3.5;  // Higher arc for floating effect
    
    const force = new CANNON.Vec3(
      (dirX / distance) * forceScale,
      upwardForce,
      (dirZ / distance) * forceScale
    );

    this.ballBody.applyImpulse(force, this.ballBody.position);
    this.state.ball.lastTouchedBy = playerId;
    this.state.waitingForServe = false;

    // Broadcast serve event
    this.broadcast("event", { 
      type: "serve", 
      server: player.nickname,
      serverRole: player.role,
      targetRole
    });
  }

  private handleBallBounce() {
    const ballPos = this.ballBody.position;
    const role = this.getQuadrantRole(ballPos.x, ballPos.z);
    
    if (role === this.state.ball.lastBounceOnRole) {
      this.state.ball.bounceCount++;
    } else {
      this.state.ball.lastBounceOnRole = role;
      this.state.ball.bounceCount = 1;
    }

    this.state.ball.lastBounceTime = this.state.elapsed;

    // Visualize bounces on client
    if (this.state.ball.bounceCount === 1) {
      this.broadcast("event", { type: "quadrantHighlight", role, color: "blue" });
    } else if (this.state.ball.bounceCount === 2) {
      this.broadcast("event", { type: "quadrantHighlight", role, color: "red" });
    }

    // Check for double bounce (elimination/demotion)
    if (this.state.ball.bounceCount >= 2) {
      this.handleDoubleBouncePenalty(role);
    }
  }

  private getQuadrantRole(x: number, z: number): string {
    if (x >= 0 && z >= 0) return "rey";
    if (x < 0 && z >= 0) return "rey1";
    if (x < 0 && z < 0) return "rey2";
    return "mato";
  }

  private handleDoubleBouncePenalty(role: string) {
    // Rotate roles after a double bounce
    if (role === "mato") {
      // If there is someone in queue, eliminate mato as before; otherwise keep playing with mato vacant
      const matoPlayer = this.getPlayerByRole("mato");
      if (matoPlayer) {
        if (this.state.queue.length > 0) {
          this.eliminatePlayer(matoPlayer.id);
        } else {
          // Vacate mato role (3-player mode)
          matoPlayer.active = false;
          matoPlayer.role = "queue";
          const body = this.playerBodies.get(matoPlayer.id);
          if (body) {
            this.world.removeBody(body);
            this.playerBodies.delete(matoPlayer.id);
          }
        }
      }
    } else {
      const changes: Array<{ playerId: string; oldRole: string; newRole: string }> = [];
      const penalized = this.getPlayerByRole(role);
      if (penalized) {
        // Rotate others: mato->rey2, rey2->rey1, rey1->rey (rey stays rey)
        const matoP = this.getPlayerByRole("mato");
        if (matoP && matoP.id !== penalized.id) {
          changes.push({ playerId: matoP.id, oldRole: "mato", newRole: "rey2" });
          matoP.role = "rey2";
          this.setPlayerPosition(matoP.id, "rey2");
        }
        const rey2P = this.getPlayerByRole("rey2");
        if (rey2P && rey2P.id !== penalized.id) {
          changes.push({ playerId: rey2P.id, oldRole: "rey2", newRole: "rey1" });
          rey2P.role = "rey1";
          this.setPlayerPosition(rey2P.id, "rey1");
        }
        const rey1P = this.getPlayerByRole("rey1");
        if (rey1P && rey1P.id !== penalized.id) {
          changes.push({ playerId: rey1P.id, oldRole: "rey1", newRole: "rey" });
          rey1P.role = "rey";
          this.setPlayerPosition(rey1P.id, "rey");
        }

        // Penalized goes to mato
        changes.push({ playerId: penalized.id, oldRole: penalized.role, newRole: "mato" });
        penalized.role = "mato";
        this.setPlayerPosition(penalized.id, "mato");

        // Notify clients to animate rotation
        this.broadcast("event", { type: "rolesRotated", changes });
      }
    }

    // Start new serve
    this.startNewServe();
  }

  private getPlayerByRole(role: string): PlayerState | null {
    for (const [_, player] of this.state.players) {
      if (player.role === role) return player;
    }
    return null;
  }

  private eliminatePlayer(playerId: string) {
    const player = this.state.players.get(playerId);
    if (!player) return;

    // Remove from active players
    player.active = false;
    player.role = "queue";
    
    // Move to end of queue
    this.state.queue.push(playerId);
    
    // Promote next player from queue to mato
    this.promoteFromQueue();
    
    this.broadcast("event", { 
      type: "elimination", 
      playerId, 
      playerName: player.nickname 
    });
  }

  private demotePlayer(playerId: string) {
    const player = this.state.players.get(playerId);
    if (!player) return;

    const oldRole = player.role;
    
    // Move demoted player to mato
    player.role = "mato";
    this.setPlayerPosition(playerId, "mato");
    
    // Rotate other players up
    this.rotatePlayersUp(oldRole);
    
    this.broadcast("event", { 
      type: "demotion", 
      playerId, 
      playerName: player.nickname,
      oldRole 
    });
  }

  private rotatePlayersUp(vacatedRole: string) {
    const rotationMap: { [key: string]: string } = {
      "rey": "rey1",
      "rey1": "rey2", 
      "rey2": "mato"
    };

    // Find players to rotate
    const playersToRotate: { player: PlayerState, newRole: string }[] = [];
    
    for (const [_, player] of this.state.players) {
      if (player.active && rotationMap[player.role]) {
        const newRole = rotationMap[player.role];
        if (newRole === vacatedRole || this.isRoleVacant(newRole)) {
          playersToRotate.push({ player, newRole });
        }
      }
    }

    // Apply rotations
    playersToRotate.forEach(({ player, newRole }) => {
      player.role = newRole;
      this.setPlayerPosition(player.id, newRole);
    });

    // Promote from queue if needed
    if (this.isRoleVacant("mato")) {
      this.promoteFromQueue();
    }
  }

  private isRoleVacant(role: string): boolean {
    for (const [_, player] of this.state.players) {
      if (player.active && player.role === role) return false;
    }
    return true;
  }

  private promoteFromQueue() {
    if (this.state.queue.length === 0) return;

    const nextPlayerId = this.state.queue.shift()!;
    const player = this.state.players.get(nextPlayerId);
    
    if (player) {
      player.active = true;
      player.role = "mato";
      this.setPlayerPosition(nextPlayerId, "mato");
      this.createPlayerBody(nextPlayerId);
    }
  }

  private setPlayerPosition(playerId: string, role: string) {
    const player = this.state.players.get(playerId);
    const playerBody = this.playerBodies.get(playerId);
    
    if (!player) return;

    let x = 0, z = 0;
    const backLineOffset = 6; // Position players closer to their back lines
    
    switch (role) {
      case "rey": x = 3; z = backLineOffset; break;      // top-right, closer to back
      case "rey1": x = -3; z = backLineOffset; break;    // top-left, closer to back
      case "rey2": x = -3; z = -backLineOffset; break;   // bottom-left, closer to back
      case "mato": x = 3; z = -backLineOffset; break;    // bottom-right, closer to back
      default: x = 0; z = -10; // queue position (further back)
    }

    player.x = x;
    player.z = z;
    player.y = 0;

    if (playerBody) {
      playerBody.position.set(x, this.PLAYER_HEIGHT / 2, z);
    }
  }

  private startNewServe() {
    // Find the current server player and position ball near them
    // Rey always serves
    this.state.currentServer = "rey";
    const serverPlayer = this.getPlayerByRole("rey");
    if (serverPlayer) {
      this.ballBody.position.set(serverPlayer.x, 1.5, serverPlayer.z);
    } else {
      this.ballBody.position.set(0, 1.5, 0);
    }
    
    this.ballBody.velocity.set(0, 0, 0);
    this.ballBody.angularVelocity.set(0, 0, 0);
    
    // Update state
    this.state.ball.x = this.ballBody.position.x;
    this.state.ball.y = this.ballBody.position.y;
    this.state.ball.z = this.ballBody.position.z;
    this.state.ball.vx = 0;
    this.state.ball.vy = 0;
    this.state.ball.vz = 0;
    this.state.ball.bounceCount = 0;
    this.state.ball.lastBounceOnRole = "";
    this.state.waitingForServe = true;

    // Broadcast serve ready event
    this.broadcast("event", { 
      type: "serveReady", 
      server: this.state.currentServer 
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    console.log(`Player ${client.sessionId} joined`);
    
    const player = new PlayerState();
    player.id = client.sessionId;
    player.nickname = options.nickname || `Player${client.sessionId.slice(0, 4)}`;
    
    this.state.players.set(client.sessionId, player);
    
    // Add to queue initially
    this.state.queue.push(client.sessionId);
    
    // Try to add to active game if there's space
    this.checkAndStartGame();
  }

  private checkAndStartGame() {
    const activePlayers = Array.from(this.state.players.values()).filter(p => p.active);
    
    if (activePlayers.length < 4 && this.state.queue.length > 0) {
      const roles = ["rey", "rey1", "rey2", "mato"];
      const usedRoles = activePlayers.map(p => p.role);
      const availableRoles = roles.filter(role => !usedRoles.includes(role));
      
      if (availableRoles.length > 0) {
        const playerId = this.state.queue.shift()!;
        const player = this.state.players.get(playerId);
        
        if (player) {
          player.active = true;
          player.role = availableRoles[0];
          this.setPlayerPosition(playerId, player.role);
          this.createPlayerBody(playerId);
        }
      }
    }

    // Start match when we have 4 players
    if (activePlayers.length === 4 && !this.state.matchStarted) {
      this.startMatch();
    }
  }

  private createPlayerBody(playerId: string) {
    const player = this.state.players.get(playerId);
    if (!player) return;

    const shape = new CANNON.Cylinder(this.PLAYER_RADIUS, this.PLAYER_RADIUS, this.PLAYER_HEIGHT, 8);
    const body = new CANNON.Body({ mass: 0.2 }); // Much lighter like the ball (ball is 0.12)
    body.addShape(shape);
    body.position.set(player.x, this.PLAYER_HEIGHT / 2, player.z);
    body.material = this.playerMat; // No-bounce behavior via contact materials
    
    // Restore some damping for natural feel; extra downward accel shapes airtime
  body.linearDamping = 0.03;
    body.angularDamping = 0.2;
    
    // Allow rotation but prevent uncontrolled spinning
    body.fixedRotation = true;
    body.updateMassProperties();
    
    this.world.addBody(body);
    this.playerBodies.set(playerId, body);
  }

  private startMatch() {
    this.state.matchStarted = true;
    this.state.elapsed = 0;
    this.reyStartTime = 0;
    
    this.startNewServe();
    
    this.broadcast("event", { type: "matchStart" });
  }

  private startGameLoop() {
    this.clock.setInterval(() => {
      this.updatePhysics();
      this.updateGameState();
    }, 1000 / 30);

    // Match timer
    this.clock.setInterval(() => {
      if (this.state.matchStarted && !this.state.matchEnded) {
        this.state.elapsed++;
        
        // Track rey time
        const reyPlayer = this.getPlayerByRole("rey");
        if (reyPlayer) {
          if (this.reyStartTime === 0) {
            this.reyStartTime = this.state.elapsed;
          }
          reyPlayer.timeAsRey = this.state.elapsed - this.reyStartTime;
        }

        // Check for match end
        if (this.state.elapsed >= this.state.matchDuration) {
          this.endMatch();
        }
      }
    }, 1000);
  }

  private updatePhysics() {
    this.world.step(1/30);
    
    // Update ball state
    this.state.ball.x = this.ballBody.position.x;
    this.state.ball.y = this.ballBody.position.y;
    this.state.ball.z = this.ballBody.position.z;
    this.state.ball.vx = this.ballBody.velocity.x;
    this.state.ball.vy = this.ballBody.velocity.y;
    this.state.ball.vz = this.ballBody.velocity.z;

    // Update player positions and apply extra downward accel for controlled airtime
    for (const [playerId, body] of this.playerBodies) {
      const player = this.state.players.get(playerId);
      if (player && player.active) {
        // Apply per-player extra downward acceleration while jumping, but not near ground
        const extraG = this.playerJumpExtraG.get(playerId) || 0;
        const groundY = this.PLAYER_HEIGHT / 2;
        if (player.jumping && extraG > 0 && body.position.y > groundY + 0.3) {
          const forceY = -extraG * body.mass;
          body.applyForce(new CANNON.Vec3(0, forceY, 0), body.position);
        }
        
        player.x = body.position.x;
        player.y = body.position.y - this.PLAYER_HEIGHT / 2;
        player.z = body.position.z;
      }
    }
  }

  private updateGameState() {
    // Keep players within court bounds and locked to ground (less aggressive)
    for (const [playerId, body] of this.playerBodies) {
      const halfCourt = this.COURT_SIZE / 2;
      const boundary = halfCourt - 0.5;
      
      // Only clamp if actually out of bounds
      if (body.position.x > boundary) {
        body.position.x = boundary;
        body.velocity.x = 0;
      } else if (body.position.x < -boundary) {
        body.position.x = -boundary;
        body.velocity.x = 0;
      }
      
      if (body.position.z > boundary) {
        body.position.z = boundary;
        body.velocity.z = 0;
      } else if (body.position.z < -boundary) {
        body.position.z = -boundary;
        body.velocity.z = 0;
      }
      
      // Prevent sinking into the ground: clamp to ground level and clear jump state
      const groundY = this.PLAYER_HEIGHT / 2;
      if (body.position.y <= groundY + 0.01) {
        body.position.y = groundY;
        if (body.velocity.y < 0) body.velocity.y = 0;
        const player = this.state.players.get(playerId);
        if (player) {
          player.jumping = false;
        }
        this.playerJumpExtraG.delete(playerId);
      }
    }

    // No additional upward force needed for beachball - let gravity work naturally
    
    // Check if ball fell through ground (invisible walls handle horizontal bounds)
    if (this.ballBody.position.y < -2) {
      // Ball fell through ground, reset serve
      this.startNewServe();
    }

    // Limit ball height but allow higher kicks
    if (this.ballBody.position.y > 10) {
      this.ballBody.velocity.y = Math.min(this.ballBody.velocity.y, 0);
    }
  }

  private endMatch() {
    this.state.matchEnded = true;
    
    // Calculate final leaderboard
    const leaderboard = Array.from(this.state.players.values())
      .filter(p => p.timeAsRey > 0)
      .sort((a, b) => b.timeAsRey - a.timeAsRey);
    
    this.broadcast("event", { 
      type: "matchEnd",
      leaderboard: leaderboard.map(p => ({
        nickname: p.nickname,
        timeAsRey: p.timeAsRey
      }))
    });
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`Player ${client.sessionId} left`);
    
    const player = this.state.players.get(client.sessionId);
    if (player && player.active) {
      // Handle active player leaving
      this.eliminatePlayer(client.sessionId);
    }
    
    // Remove from queue
    const queueIndex = this.state.queue.indexOf(client.sessionId);
    if (queueIndex >= 0) {
      this.state.queue.splice(queueIndex, 1);
    }

    // Remove player body
    const body = this.playerBodies.get(client.sessionId);
    if (body) {
      this.world.removeBody(body);
      this.playerBodies.delete(client.sessionId);
    }

    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("Room disposed");
  }
}