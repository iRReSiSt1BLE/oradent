export {};

declare global {
    interface Window {
        google?: {
            payments?: {
                api?: {
                    PaymentsClient: new (options: {
                        environment: 'TEST' | 'PRODUCTION';
                    }) => {
                        isReadyToPay: (request: unknown) => Promise<{ result: boolean }>;
                        loadPaymentData: (request: unknown) => Promise<any>;
                    };
                };
            };
        };
    }
}