describe("REBUILT offline scouting flow", () => {
  it("runs eyes-free terminal seat + match flow", () => {
    cy.intercept("POST", "http://localhost:8001/auth/scout-login", {
      statusCode: 200,
      body: { username: "scout_red_1", seat: "red1", role: "live_scout" },
    });
    cy.intercept("GET", "http://localhost:8001/events/*/active-qual", {
      statusCode: 200,
      body: { match_key: "2026miket_qm21", red: ["frc1", "frc2", "frc3"], blue: ["frc4", "frc5", "frc6"], source: "mock" },
    });
    cy.visit("/");
    cy.get("input[placeholder='username']").type("scout_red_1");
    cy.get("input[placeholder='pin']").type("1111");
    cy.contains("LOGIN").click();
    cy.get("[data-cy=ready-label]").should("contain", "frc1");
    cy.get("[data-cy=start-match]").click();
    cy.get("[data-cy=battle-canvas]").click(100, 120).click(140, 140);
    cy.get("[data-cy=auto-winner-red]").click();
    cy.get("[data-cy=hub-live]").should("contain", "HUB");
    cy.get("[data-cy=shoot-hold]").trigger("mousedown");
    cy.wait(100);
    cy.get("[data-cy=shoot-hold]").trigger("mouseup", { clientY: 20 });
  });

  it("supports refinery and war room actions", () => {
    cy.intercept("POST", "http://localhost:8001/refinery/revise", {
      statusCode: 200,
      body: { match_key: "x", team_key: "y", revised_count: 2, inventory_capacity: 5 },
    });
    cy.intercept("POST", "http://localhost:8001/warroom/multi-path-overlay", {
      statusCode: 200,
      body: { match_key: "x", warnings: [{ robot_a: "A", robot_b: "B", t_ms: 2000, x: 1, y: 2 }] },
    });
    cy.intercept("POST", "http://localhost:8001/strategy/win-predict", {
      statusCode: 200,
      body: { win_probability: 0.61, rationale: "mock model" },
    });
    cy.intercept("POST", "http://localhost:8001/warroom/tactical-insight", {
      statusCode: 200,
      body: { insight: "Defend right trench" },
    });
    cy.visit("/");
    cy.get("[data-cy=mode-refinery]").click();
    cy.get("[data-cy=submit-revision]").click();
    cy.get("[data-cy=revision-result]").should("contain", "Revized");

    cy.get("[data-cy=mode-warroom]").click();
    cy.get("[data-cy=overlay]").click();
    cy.get("[data-cy=collision-warnings]").should("contain", "COLLISION");
    cy.get("[data-cy=hybrid-win]").click();
    cy.get("[data-cy=predict-output]").should("contain", "Win");
    cy.get("[data-cy=llm-tactic]").click();
    cy.get("[data-cy=insight-output]").should("contain", "Defend");
  });
});
