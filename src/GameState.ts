import { Schema, type, MapSchema } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") nickname: string = "";
  @type("string") role: string = "queue"; // "rey" | "rey1" | "rey2" | "mato" | "queue"
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") z: number = 0;
  @type("float32") rotY: number = 0;
  @type("boolean") active: boolean = false;
  @type("float32") timeAsRey: number = 0;
  @type("boolean") jumping: boolean = false;
  @type("float32") vx: number = 0;
  @type("float32") vz: number = 0;
}

export class BallState extends Schema {
  @type("float32") x: number = 0;
  @type("float32") y: number = 1;
  @type("float32") z: number = 0;
  @type("float32") vx: number = 0;
  @type("float32") vy: number = 0;
  @type("float32") vz: number = 0;
  @type("string") lastTouchedBy: string = "";
  @type("string") lastBounceOnRole: string = "";
  @type("float32") lastBounceTime: number = 0;
  @type("uint8") bounceCount: number = 0; // bounces on current role's court
}

export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type(BallState) ball = new BallState();
  @type("string") currentServer: string = "";
  @type(["string"]) queue: string[] = [];
  @type("float32") elapsed: number = 0;
  @type("float32") matchDuration: number = 300; // 5 minutes default
  @type("boolean") matchStarted: boolean = false;
  @type("boolean") matchEnded: boolean = false;
  @type("boolean") waitingForServe: boolean = false;
}