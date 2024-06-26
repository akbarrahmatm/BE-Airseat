const dotenv = require("dotenv");
dotenv.config();

const request = require("supertest");
const app = require("../../app");

describe("[API ERROR HANDLER TESTS]", () => {
  test("Not found routes", async () => {
    const response = await request(app).post("/api/v1/tesesattt");

    expect(response.statusCode).toBe(404);
    expect(response.body.status).toBe("Failed");
    expect(response.body.message).toBe("Routes not found");
    expect(response.body.requestAt).not.toBeNull();
  });
});
