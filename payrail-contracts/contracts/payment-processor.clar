;; title: payment-processor
;; version: 1.0.0
;; summary: Multi-chain payment gateway processor for accepting crypto payments
;; description: Core smart contract for processing payments, managing settlements, and handling fees

;; traits
;;

;; token definitions
;;

;; constants
;;
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-invalid-payment (err u101))
(define-constant err-payment-not-found (err u102))
(define-constant err-payment-already-processed (err u103))
(define-constant err-insufficient-amount (err u104))
(define-constant err-invalid-merchant (err u105))

;; Fee constants (in basis points - 100 = 1%)
(define-constant default-fee-rate u150) ;; 1.5%
(define-constant max-fee-rate u500)     ;; 5%

;; data vars
;;
(define-data-var fee-rate uint default-fee-rate)
(define-data-var treasury principal contract-owner)
(define-data-var contract-paused bool false)

;; data maps
;;
(define-map payments
  { payment-id: (string-ascii 64) }
  {
    merchant: principal,
    amount: uint,
    token: (string-ascii 20),
    status: (string-ascii 20),
    fee-amount: uint,
    timestamp: uint,
    settlement-currency: (string-ascii 10),
    customer: (optional principal)
  }
)

(define-map merchants
  { merchant: principal }
  {
    active: bool,
    fee-rate: uint,
    settlement-preference: (string-ascii 10),
    total-volume: uint,
    total-fees: uint
  }
)

(define-map payment-settlements
  { payment-id: (string-ascii 64) }
  {
    settled: bool,
    settlement-amount: uint,
    settlement-token: (string-ascii 20),
    settlement-timestamp: uint
  }
)

;; public functions
;;

;; Initialize merchant account
(define-public (register-merchant (merchant principal) (settlement-preference (string-ascii 10)))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ok (map-set merchants
      { merchant: merchant }
      {
        active: true,
        fee-rate: (var-get fee-rate),
        settlement-preference: settlement-preference,
        total-volume: u0,
        total-fees: u0
      }
    ))
  )
)

;; Create a payment request
(define-public (create-payment
  (payment-id (string-ascii 64))
  (merchant principal)
  (amount uint)
  (token (string-ascii 20))
  (settlement-currency (string-ascii 10)))
  (let
    (
      (merchant-data (unwrap! (map-get? merchants { merchant: merchant }) err-invalid-merchant))
      (fee-amount (/ (* amount (get fee-rate merchant-data)) u10000))
    )
    (asserts! (not (var-get contract-paused)) err-invalid-payment)
    (asserts! (> amount u0) err-insufficient-amount)
    (asserts! (get active merchant-data) err-invalid-merchant)
    (asserts! (is-none (map-get? payments { payment-id: payment-id })) err-payment-already-processed)

    (ok (map-set payments
      { payment-id: payment-id }
      {
        merchant: merchant,
        amount: amount,
        token: token,
        status: "pending",
        fee-amount: fee-amount,
        timestamp: stacks-block-height,
        settlement-currency: settlement-currency,
        customer: (some tx-sender)
      }
    ))
  )
)

;; Process STX payment
(define-public (process-stx-payment (payment-id (string-ascii 64)))
  (let
    (
      (payment-data (unwrap! (map-get? payments { payment-id: payment-id }) err-payment-not-found))
      (merchant (get merchant payment-data))
      (amount (get amount payment-data))
      (fee-amount (get fee-amount payment-data))
      (net-amount (- amount fee-amount))
    )
    (asserts! (is-eq (get status payment-data) "pending") err-payment-already-processed)
    (asserts! (is-eq (get token payment-data) "STX") err-invalid-payment)

    ;; Transfer STX from customer to merchant and treasury
    (try! (stx-transfer? net-amount tx-sender merchant))
    (try! (stx-transfer? fee-amount tx-sender (var-get treasury)))

    ;; Update payment status
    (map-set payments
      { payment-id: payment-id }
      (merge payment-data { status: "completed" })
    )

    ;; Update merchant stats
    (update-merchant-stats merchant amount fee-amount)

    ;; Create settlement record
    (map-set payment-settlements
      { payment-id: payment-id }
      {
        settled: true,
        settlement-amount: net-amount,
        settlement-token: "STX",
        settlement-timestamp: stacks-block-height
      }
    )

    (ok payment-id)
  )
)

;; Update merchant statistics
(define-private (update-merchant-stats (merchant principal) (volume uint) (fees uint))
  (let
    (
      (current-data (unwrap-panic (map-get? merchants { merchant: merchant })))
    )
    (map-set merchants
      { merchant: merchant }
      (merge current-data
        {
          total-volume: (+ (get total-volume current-data) volume),
          total-fees: (+ (get total-fees current-data) fees)
        }
      )
    )
  )
)

;; Admin functions

;; Update fee rate
(define-public (set-fee-rate (new-rate uint))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (asserts! (<= new-rate max-fee-rate) err-invalid-payment)
    (ok (var-set fee-rate new-rate))
  )
)

;; Update treasury address
(define-public (set-treasury (new-treasury principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ok (var-set treasury new-treasury))
  )
)

;; Emergency pause
(define-public (pause-contract)
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ok (var-set contract-paused true))
  )
)

;; Unpause contract
(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ok (var-set contract-paused false))
  )
)

;; read only functions
;;

;; Get payment details
(define-read-only (get-payment (payment-id (string-ascii 64)))
  (map-get? payments { payment-id: payment-id })
)

;; Get merchant details
(define-read-only (get-merchant (merchant principal))
  (map-get? merchants { merchant: merchant })
)

;; Get settlement details
(define-read-only (get-settlement (payment-id (string-ascii 64)))
  (map-get? payment-settlements { payment-id: payment-id })
)

;; Get current fee rate
(define-read-only (get-fee-rate)
  (var-get fee-rate)
)

;; Get treasury address
(define-read-only (get-treasury)
  (var-get treasury)
)

;; Check if contract is paused
(define-read-only (is-paused)
  (var-get contract-paused)
)

;; Calculate fee for amount
(define-read-only (calculate-fee (merchant principal) (amount uint))
  (let
    (
      (merchant-data (map-get? merchants { merchant: merchant }))
    )
    (match merchant-data
      some-data (/ (* amount (get fee-rate some-data)) u10000)
      (/ (* amount (var-get fee-rate)) u10000)
    )
  )
)

;; private functions
;;

