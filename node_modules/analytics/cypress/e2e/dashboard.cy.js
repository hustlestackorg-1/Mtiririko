describe('Mtiririko Analytics Dashboard E2E', () => {
    beforeEach(() => {
        // Assuming the dashboard is running on port 4000
        cy.visit('http://localhost:4000');
    });

    it('Visits the dashboard and verifies core Mtiririko metrics', () => {
        cy.contains('h1', 'Flowing Value,');
        cy.contains('h3', 'Ecosystem Volume (cKES)');
        cy.contains('span', 'KYC Anomalies (>1M)');
    });

    it('Displays anonymized recent transactions correctly', () => {
        cy.contains('h2', 'Real-Time Ledger');
        cy.get('table').should('exist');
        cy.get('th').contains('Transaction ID');
        cy.get('th').contains('Sender Hash (SHA-256)');
        cy.get('th').contains('Amount (Ksh)');
    });

    it('Identifies high-value anomaly transactions visually via Tailwind classes', () => {
        // Validates the 'text-red-500' class formatting for KYC flagged transfers > 1,000,000 Ksh
        cy.get('table').find('td.text-red-500').should('have.css', 'color', 'rgb(239, 68, 68)');
    });
});
