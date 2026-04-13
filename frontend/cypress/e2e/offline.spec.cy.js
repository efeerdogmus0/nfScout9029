describe("REBUILT offline scouting flow", () => {
  it("tracks teleop and generates QR in offline mode", () => {
    cy.visit("/");
    cy.window().then((win) => {
      win.dispatchEvent(new Event("offline"));
    });

    cy.get("[data-cy=hub-inactive]").click();
    cy.get("[data-cy=add-fuel]").click();
    cy.get("[data-cy=inactive-count]").should("contain", "1");

    cy.get("[data-cy=shoot]").click().click();
    cy.get("[data-cy=avg-cycle-ms]").should("contain", "Avg cycle");

    cy.get("[data-cy=ping]").click().click();
    cy.get("[data-cy=ping-count]").should("contain", "2");

    cy.get("[data-cy=save-offline]").click();
    cy.get("[data-cy=qr-image]").should("be.visible");
  });
});
