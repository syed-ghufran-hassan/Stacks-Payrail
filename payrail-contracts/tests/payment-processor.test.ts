import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const merchant1 = accounts.get("wallet_1")!;
const merchant2 = accounts.get("wallet_2")!;
const customer1 = accounts.get("wallet_3")!;
const customer2 = accounts.get("wallet_4")!;

const contractName = "payment-processor";

describe("Payment Processor Smart Contract", () => {

  describe("Contract Initialization", () => {
    it("should initialize with correct default values", () => {
      const feeRate = simnet.callReadOnlyFn(contractName, "get-fee-rate", [], deployer);
      expect(feeRate.result).toBeUint(150); // 1.5%

      const treasury = simnet.callReadOnlyFn(contractName, "get-treasury", [], deployer);
      expect(treasury.result).toBePrincipal(deployer);

      const paused = simnet.callReadOnlyFn(contractName, "is-paused", [], deployer);
      expect(paused.result).toBeBool(false);
    });
  });

  describe("Merchant Management", () => {
    it("should allow owner to register a merchant", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const merchantData = simnet.callReadOnlyFn(
        contractName,
        "get-merchant",
        [Cl.principal(merchant1)],
        deployer
      );
      expect(merchantData.result).toBeSome(
        Cl.tuple({
          active: Cl.bool(true),
          "fee-rate": Cl.uint(150),
          "settlement-preference": Cl.stringAscii("USD"),
          "total-volume": Cl.uint(0),
          "total-fees": Cl.uint(0)
        })
      );
    });

    it("should allow owner to register multiple merchants with different preferences", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant2), Cl.stringAscii("EUR")],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const merchantData = simnet.callReadOnlyFn(
        contractName,
        "get-merchant",
        [Cl.principal(merchant2)],
        deployer
      );
      expect(merchantData.result).toBeSome(
        Cl.tuple({
          active: Cl.bool(true),
          "fee-rate": Cl.uint(150),
          "settlement-preference": Cl.stringAscii("EUR"),
          "total-volume": Cl.uint(0),
          "total-fees": Cl.uint(0)
        })
      );
    });

    it("should prevent non-owner from registering merchants", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        merchant1
      );
      expect(result).toBeErr(Cl.uint(100));
    });
  });

  describe("Payment Creation", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );
    });

    it("should create a payment successfully", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-001"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeOk(Cl.bool(true));

      const paymentData = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii("payment-001")],
        customer1
      );
      expect(paymentData.result).toBeSome(
        Cl.tuple({
          merchant: Cl.principal(merchant1),
          amount: Cl.uint(1000000),
          token: Cl.stringAscii("STX"),
          status: Cl.stringAscii("pending"),
          "fee-amount": Cl.uint(15000),
          timestamp: Cl.uint(simnet.blockHeight + 1),
          "settlement-currency": Cl.stringAscii("USD"),
          customer: Cl.some(Cl.principal(customer1))
        })
      );
    });

    it("should allow multiple payments from different customers", () => {
      // Payment from customer1
      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-cust1"),
          Cl.principal(merchant1),
          Cl.uint(500000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      // Payment from customer2
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-cust2"),
          Cl.principal(merchant1),
          Cl.uint(750000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer2
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify both payments exist
      const payment1 = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii("payment-cust1")],
        deployer
      );
      const payment2 = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii("payment-cust2")],
        deployer
      );
      expect(payment1.result).toBeSome();
      expect(payment2.result).toBeSome();
    });

    it("should allow payments with different tokens", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-btc"),
          Cl.principal(merchant1),
          Cl.uint(5000000),
          Cl.stringAscii("BTC"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeOk(Cl.bool(true));

      const paymentData = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii("payment-btc")],
        deployer
      );
      const payment = paymentData.result.expectSome();
      expect(payment['token']).toBe(Cl.stringAscii("BTC"));
    });

    it("should prevent payment creation for unregistered merchant", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-001"),
          Cl.principal(merchant2),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeErr(Cl.uint(105));
    });
  });

  describe("STX Payment Processing", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );
    });

    it("should process STX payment successfully", () => {
      const paymentId = "payment-stx-001";
      const amount = 1000000;
      const feeAmount = 15000;
      const netAmount = amount - feeAmount;

      // Get initial balances
      const customerBalanceBefore = simnet.getAssetsMap().get("STX")?.get(customer1) || 0n;
      const merchantBalanceBefore = simnet.getAssetsMap().get("STX")?.get(merchant1) || 0n;
      const treasuryBalanceBefore = simnet.getAssetsMap().get("STX")?.get(deployer) || 0n;

      // Create payment
      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(amount),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      // Process payment
      const { result, events } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii(paymentId)],
        customer1
      );
      expect(result).toBeOk(Cl.stringAscii(paymentId));

      // Verify STX transfer events
      const stxTransfers = events.filter(e => e.event === "stx_transfer_event");
      expect(stxTransfers.length).toBe(2);

      // Verify balances updated
      const customerBalanceAfter = simnet.getAssetsMap().get("STX")?.get(customer1) || 0n;
      const merchantBalanceAfter = simnet.getAssetsMap().get("STX")?.get(merchant1) || 0n;
      const treasuryBalanceAfter = simnet.getAssetsMap().get("STX")?.get(deployer) || 0n;

      expect(customerBalanceAfter).toBe(customerBalanceBefore - BigInt(amount));
      expect(merchantBalanceAfter).toBe(merchantBalanceBefore + BigInt(netAmount));
      expect(treasuryBalanceAfter).toBe(treasuryBalanceBefore + BigInt(feeAmount));

      // Verify payment status updated
      const paymentData = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii(paymentId)],
        deployer
      );
      expect(paymentData.result).toBeSome();
      expect(paymentData.result.expectSome()['status']).toBe(Cl.stringAscii("completed"));
    });

    it("should update merchant statistics correctly", () => {
      const paymentId = "payment-stats-001";
      const amount = 2000000;
      const feeAmount = 30000; // 1.5% of 2000000

      // Get initial merchant stats
      const statsBefore = simnet.callReadOnlyFn(
        contractName,
        "get-merchant",
        [Cl.principal(merchant1)],
        deployer
      ).result.expectSome();

      // Create and process payment
      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(amount),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii(paymentId)],
        customer1
      );

      // Get updated stats
      const statsAfter = simnet.callReadOnlyFn(
        contractName,
        "get-merchant",
        [Cl.principal(merchant1)],
        deployer
      ).result.expectSome();

      expect(statsAfter['total-volume']).toBeUint(Number(statsBefore['total-volume']) + amount - feeAmount);
      expect(statsAfter['total-fees']).toBeUint(Number(statsBefore['total-fees']) + feeAmount);
    });

    it("should create settlement record after processing", () => {
      const paymentId = "payment-settlement-001";
      const amount = 2000000;
      const netAmount = amount - 30000; // amount - fee

      // Create and process payment
      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(amount),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii(paymentId)],
        customer1
      );

      // Check settlement record
      const settlementData = simnet.callReadOnlyFn(
        contractName,
        "get-settlement",
        [Cl.stringAscii(paymentId)],
        deployer
      );

      expect(settlementData.result).toBeSome(
        Cl.tuple({
          settled: Cl.bool(true),
          "settlement-amount": Cl.uint(netAmount),
          "settlement-token": Cl.stringAscii("STX"),
          "settlement-timestamp": Cl.uint(simnet.blockHeight + 2)
        })
      );
    });

    it("should process multiple payments and update merchant stats cumulatively", () => {
      const payments = [
        { id: "multi-1", amount: 1000000 },
        { id: "multi-2", amount: 2000000 },
        { id: "multi-3", amount: 1500000 }
      ];

      let totalVolume = 0;
      let totalFees = 0;

      for (const payment of payments) {
        const fee = payment.amount * 150 / 10000; // 1.5%
        const net = payment.amount - fee;

        simnet.callPublicFn(
          contractName,
          "create-payment",
          [
            Cl.stringAscii(payment.id),
            Cl.principal(merchant1),
            Cl.uint(payment.amount),
            Cl.stringAscii("STX"),
            Cl.stringAscii("USD")
          ],
          customer1
        );

        simnet.callPublicFn(
          contractName,
          "process-stx-payment",
          [Cl.stringAscii(payment.id)],
          customer1
        );

        totalVolume += net;
        totalFees += fee;
      }

      const stats = simnet.callReadOnlyFn(
        contractName,
        "get-merchant",
        [Cl.principal(merchant1)],
        deployer
      ).result.expectSome();

      expect(stats['total-volume']).toBeUint(totalVolume);
      expect(stats['total-fees']).toBeUint(totalFees);
    });

    it("should prevent processing non-STX payments", () => {
      const paymentId = "payment-btc-001";

      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("BTC"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii(paymentId)],
        customer1
      );
      expect(result).toBeErr(Cl.uint(101));
    });

    it("should prevent processing payment by wrong customer", () => {
      const paymentId = "payment-wrong-cust";

      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      // Try to process as different customer
      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii(paymentId)],
        customer2
      );
      expect(result).toBeErr(Cl.uint(101)); // err-invalid-payment (insufficient balance)
    });

    it("should prevent processing with insufficient balance", () => {
      const paymentId = "payment-insufficient";
      const hugeAmount = 1000000000000; // Very large amount

      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(hugeAmount),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii(paymentId)],
        customer1
      );
      expect(result).toBeErr(Cl.uint(1)); // ERR-ASSERTION-FAILED from stx-transfer?
    });

    it("should prevent processing non-existent payment", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("nonexistent")],
        customer1
      );
      expect(result).toBeErr(Cl.uint(102));
    });

    it("should prevent double processing", () => {
      const paymentId = "payment-double";

      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii(paymentId)],
        customer1
      );

      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii(paymentId)],
        customer1
      );
      expect(result).toBeErr(Cl.uint(103));
    });
  });

  describe("Admin Functions", () => {
    it("should allow owner to update fee rate within limits", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-rate",
        [Cl.uint(200)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const newFeeRate = simnet.callReadOnlyFn(contractName, "get-fee-rate", [], deployer);
      expect(newFeeRate.result).toBeUint(200);
    });

    it("should prevent setting fee rate above maximum", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-rate",
        [Cl.uint(600)],
        deployer
      );
      expect(result).toBeErr(Cl.uint(101));
    });

    it("should allow setting fee rate at maximum", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-rate",
        [Cl.uint(500)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const newFeeRate = simnet.callReadOnlyFn(contractName, "get-fee-rate", [], deployer);
      expect(newFeeRate.result).toBeUint(500);
    });

    it("should prevent non-owner from updating fee rate", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-rate",
        [Cl.uint(200)],
        merchant1
      );
      expect(result).toBeErr(Cl.uint(100));
    });

    it("should allow owner to update treasury", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-treasury",
        [Cl.principal(merchant1)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const newTreasury = simnet.callReadOnlyFn(contractName, "get-treasury", [], deployer);
      expect(newTreasury.result).toBePrincipal(merchant1);
    });

    it("should prevent non-owner from updating treasury", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-treasury",
        [Cl.principal(merchant1)],
        merchant1
      );
      expect(result).toBeErr(Cl.uint(100));
    });

    it("should allow owner to pause and unpause contract", () => {
      // Pause
      const pauseResult = simnet.callPublicFn(contractName, "pause-contract", [], deployer);
      expect(pauseResult.result).toBeOk(Cl.bool(true));

      let paused = simnet.callReadOnlyFn(contractName, "is-paused", [], deployer);
      expect(paused.result).toBeBool(true);

      // Unpause
      const unpauseResult = simnet.callPublicFn(contractName, "unpause-contract", [], deployer);
      expect(unpauseResult.result).toBeOk(Cl.bool(true));

      paused = simnet.callReadOnlyFn(contractName, "is-paused", [], deployer);
      expect(paused.result).toBeBool(false);
    });

    it("should prevent non-owner from pausing", () => {
      const { result } = simnet.callPublicFn(contractName, "pause-contract", [], merchant1);
      expect(result).toBeErr(Cl.uint(100));
    });
  });

  describe("Fee Calculation", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );
    });

    it("should calculate fees correctly for registered merchant", () => {
      const feeData = simnet.callReadOnlyFn(
        contractName,
        "calculate-fee",
        [Cl.principal(merchant1), Cl.uint(1000000)],
        deployer
      );
      expect(feeData.result).toBeUint(15000);
    });

    it("should use default fee rate for unregistered merchant", () => {
      const feeData = simnet.callReadOnlyFn(
        contractName,
        "calculate-fee",
        [Cl.principal(merchant2), Cl.uint(1000000)],
        deployer
      );
      expect(feeData.result).toBeUint(15000);
    });

    it("should calculate fees for various amounts", () => {
      const testCases = [
        { amount: 100, expected: 1 }, // 1.5% of 100 = 1.5 -> 1 (floor)
        { amount: 1000, expected: 15 },
        { amount: 10000, expected: 150 },
        { amount: 100000, expected: 1500 },
        { amount: 1000000, expected: 15000 },
        { amount: 10000000, expected: 150000 }
      ];

      for (const tc of testCases) {
        const feeData = simnet.callReadOnlyFn(
          contractName,
          "calculate-fee",
          [Cl.principal(merchant1), Cl.uint(tc.amount)],
          deployer
        );
        expect(feeData.result).toBeUint(tc.expected);
      }
    });

    it("should reflect updated fee rates in calculations", () => {
      // Update fee rate to 2%
      simnet.callPublicFn(contractName, "set-fee-rate", [Cl.uint(200)], deployer);

      const feeData = simnet.callReadOnlyFn(
        contractName,
        "calculate-fee",
        [Cl.principal(merchant1), Cl.uint(1000000)],
        deployer
      );
      expect(feeData.result).toBeUint(20000); // 2% of 1000000
    });
  });

  describe("Edge Cases and Error Handling", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );
    });

    it("should prevent payment creation when contract is paused", () => {
      simnet.callPublicFn(contractName, "pause-contract", [], deployer);

      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-paused"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeErr(Cl.uint(101));
    });

    it("should prevent zero amount payments", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-zero"),
          Cl.principal(merchant1),
          Cl.uint(0),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeErr(Cl.uint(104));
    });

    it("should prevent duplicate payment IDs", () => {
      const paymentId = "duplicate-id";

      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii(paymentId),
          Cl.principal(merchant1),
          Cl.uint(2000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeErr(Cl.uint(103));
    });

    it("should handle missing data gracefully", () => {
      // Missing payment
      const paymentData = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii("nonexistent")],
        deployer
      );
      expect(paymentData.result).toBeNone();

      // Missing merchant
      const merchantData = simnet.callReadOnlyFn(
        contractName,
        "get-merchant",
        [Cl.principal(customer1)],
        deployer
      );
      expect(merchantData.result).toBeNone();

      // Missing settlement
      const settlementData = simnet.callReadOnlyFn(
        contractName,
        "get-settlement",
        [Cl.stringAscii("nonexistent")],
        deployer
      );
      expect(settlementData.result).toBeNone();
    });
  });

  describe("Concurrent Payments", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );
    });

    it("should handle multiple payments from same customer", () => {
      const payments = [
        { id: "same-cust-1", amount: 1000000 },
        { id: "same-cust-2", amount: 2000000 },
        { id: "same-cust-3", amount: 3000000 }
      ];

      for (const payment of payments) {
        const createResult = simnet.callPublicFn(
          contractName,
          "create-payment",
          [
            Cl.stringAscii(payment.id),
            Cl.principal(merchant1),
            Cl.uint(payment.amount),
            Cl.stringAscii("STX"),
            Cl.stringAscii("USD")
          ],
          customer1
        );
        expect(createResult.result).toBeOk(Cl.bool(true));

        const processResult = simnet.callPublicFn(
          contractName,
          "process-stx-payment",
          [Cl.stringAscii(payment.id)],
          customer1
        );
        expect(processResult.result).toBeOk(Cl.stringAscii(payment.id));
      }

      // Verify all payments completed
      for (const payment of payments) {
        const paymentData = simnet.callReadOnlyFn(
          contractName,
          "get-payment",
          [Cl.stringAscii(payment.id)],
          deployer
        );
        expect(paymentData.result.expectSome()['status']).toBe(Cl.stringAscii("completed"));
      }
    });

    it("should handle payments to different merchants", () => {
      // Register second merchant
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant2), Cl.stringAscii("EUR")],
        deployer
      );

      // Payment to merchant1
      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("multi-merchant-1"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      // Payment to merchant2
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("multi-merchant-2"),
          Cl.principal(merchant2),
          Cl.uint(2000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("EUR")
        ],
        customer1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Process both
      simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("multi-merchant-1")],
        customer1
      );

      const process2 = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("multi-merchant-2")],
        customer1
      );
      expect(process2.result).toBeOk(Cl.stringAscii("multi-merchant-2"));
    });
  });
});
