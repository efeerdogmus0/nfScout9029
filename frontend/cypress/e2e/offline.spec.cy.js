describe("REBUILT app smoke", () => {
  it("field scout: login → ready → auto path → save → pick auto winner → hub visible", () => {
    cy.clock(Date.now(), ["Date"]);
    cy.intercept("GET", "**/events/*/active-qual*", {
      statusCode: 200,
      body: {
        match_key: "2026miket_qm21",
        red: ["frc254", "frc1114", "frc118"],
        blue: ["frc1", "frc2", "frc3"],
        source: "mock",
      },
    }).as("activeQual");
    cy.intercept("GET", "**/events/*/schedule*", { statusCode: 200, body: [] }).as("schedule");
    cy.intercept("POST", "**/live/scout-status*", { statusCode: 200, body: [] }).as("heartbeat");
    cy.intercept("GET", "**/live/hub-state/current*", {
      statusCode: 200,
      body: { hub_state: "active", source: "test" },
    }).as("hubHealth");

    cy.visit("/");

    cy.get("[data-cy=crew-name]").type("Cypress Scout");
    // İlk yüklemede getNextAvailableSeat() zaten bir koltuk seçer; aynı koltuğa tekrar tıklamak seçimi kapatır.
    cy.get("[data-cy=field-login-go]").should("not.be.disabled").click();

    cy.get("[data-cy=ready-label]").should("contain", "254");

    cy.get("[data-cy=start-match]").click();
    cy.get("[data-cy=battle-canvas]").click(320, 160);

    cy.tick(21_000);
    cy.get("[data-cy=auto-save]").click();
    cy.get("[data-cy=auto-winner-red]").click();
    cy.get("[data-cy=hub-live]").should("contain", "HUB");
  });

  it("admin: Test tab → StrategyDashboard win predict", () => {
    cy.intercept("POST", "**/strategy/win-predict*", {
      statusCode: 200,
      body: { win_probability: 0.61, rationale: "mock model" },
    }).as("winPredict");

    cy.visit("/");
    cy.get("[data-cy=quick-admin]").click();
    cy.get("[data-cy=nav-test]").click();
    cy.get("[data-cy=run-win-predict]").click();
    cy.wait("@winPredict");
    cy.get("[data-cy=win-predict]").should("contain", "61");
  });
});
