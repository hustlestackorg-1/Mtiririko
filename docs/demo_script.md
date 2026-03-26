# Mtiririko - Celo Sepolia Pilot Demo Script

This script aims to guide presenters through the end-to-end pilot demonstration for vendors (e.g., Gikomba or Toi Market), Central Bank sandbox officers, or iHub participants.

## Environment Preparation
1. Ensure the Node Middleware is actively parsing Sepolia transactions: `cd apps/middleware && node src/server.js`
2. Boot the Analytics Dashboard: `cd apps/analytics && node src/dashboard.js`
3. Expose the React Native Expo app on a physical test device via `npm run android`.

## The Pitch Flow

### Scene 1: The Fiat On-Ramp (M-Pesa Hook)
* **Goal**: Show immediate stablecoin issuance upon mobile money receipt.
* **Action**: Ping the middleware `/webhook` (via Postman) simulating Safaricom Daraja depositing Ksh 500.
* **Talking Point**: "Notice the zero-latency bridging. As soon as the vendor receives Ksh via their traditional M-Pesa line, our gateway natively maps that mobile number and mints 500 `cKES` directly into their secure Celo Sepolia address. The vendor hasn't touched a crypto exchange."

### Scene 2: The Core Differentiator — Offline Biometric Micro-Transfers
* **Goal**: Demonstrate how Mtiririko works during grid power-cuts or rural connectivity deadzones.
* **Action**: Toggle Airplane Mode on the mobile test device.
* **Flow**: Input Ksh 50 -> Hit Send -> **Prompt Biometrics** (Fingerprint/FaceID via hardware). 
* **Talking Point**: "Without internet, this Ksh 50 payment is encrypted and secured offline on the device using `expo-secure-store`. The biometric check ensures no one else can queue fraudulent physical transfers from this phone."

### Scene 3: The Seamless "Gasless" Settlement
* **Goal**: Show the Relayer resolving the queued payload silently, subsidizing the user.
* **Action**: Turn off Airplane Mode on the device.
* **Flow**: Let the automatic background polling sync the transaction payload to the middleware gateway.
* **Talking Point**: "Once back online, the app sweeps the payload. It fires off to Celo Sepolia where our Smart Contract Batcher processes it. In Mtiririko, the user never pays the gas fee; our governance 'Gas Station' treasury funds the relayer automatically."

### Scene 4: The Regulator's View (Data Analytics)
* **Goal**: Instill confidence in transparency and AML compliance without sacrificing Data Privacy.
* **Action**: Open `localhost:4000` to view the EJS dashboard.
* **Talking Point**: "All transactions are immediately indexed via Kafka streams. Notice how Phone Numbers are natively Hashed (SHA-256) keeping PII strictly compliant with the Kenya Data Protection Act. High value transactions (> Ksh 1M) flag immediately for KYC review."
* **Final Action**: Click the "Export CSV for Reporting" button on the dashboard to hand mock data to the stakeholders.
