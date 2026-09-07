import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';

// Firebase configuration from provisioned environment
export const firebaseConfig = {
  projectId: 'gen-lang-client-0950888049',
  appId: '1:917170474724:web:4aef2babd4a5f45ac9e6f1',
  apiKey: 'AIzaSyCFwjUQ1OYBb0_lBJp3a2MldN0KDnvSLDo',
  authDomain: 'gen-lang-client-0950888049.firebaseapp.com',
  storageBucket: 'gen-lang-client-0950888049.firebasestorage.app',
  messagingSenderId: '917170474724',
};

const app = initializeApp(firebaseConfig);
const databaseId = 'ai-studio-kelvo-903d5c90-63f4-485f-8ea8-040816996167';
export const db = getFirestore(app, databaseId);

// WhatsApp and Admin Constants
export const WHATSAPP_NUMBER = '919136626006'; // Official Kelvo WhatsApp Concierge: +91 91366 26006
export const ADMIN_PASSWORD = 'kelvo-craft-2024'; // Simple password gate for /admin

export interface Product {
  id: string;
  name: string;
  price: number;
  tastingNote: string;
  stock: number;
  isPreorder: boolean;
}

export interface OrderItem {
  flavor: string;
  flavorId: string;
  quantity: number;
  unitPrice: number;
  format?: string;
}

export interface Order {
  id: string;
  customerName: string;
  phone: string;
  email?: string;
  deliveryAddress: string;
  items: OrderItem[];
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'fulfilled';
  isPreorder: boolean;
  createdAt: any;
}

// Initial launch stock and pricing matching the site
export const INITIAL_PRODUCTS: Record<string, Omit<Product, 'id'>> = {
  hazelnut: {
    name: 'Hazelnut',
    price: 549,
    tastingNote: 'Toasted, nutty, smooths out with oat milk.',
    stock: 40,
    isPreorder: false,
  },
  vanilla: {
    name: 'Vanilla',
    price: 499,
    tastingNote: 'Sweet Madagascar bean notes. A clean, classic morning kick.',
    stock: 40,
    isPreorder: false,
  },
  whiskey: {
    name: 'Whiskey',
    price: 599,
    tastingNote: 'Barrel-aged warmth, no alcohol, all character.',
    stock: 25,
    isPreorder: false,
  },
  caramel: {
    name: 'Caramel',
    price: 549,
    tastingNote: 'Burnt sugar and flaked sea salt. Indulgence without the work.',
    stock: 40,
    isPreorder: false,
  },
};

/**
 * Seed Firestore products collection on first run if documents do not exist
 */
export async function seedProductsIfEmpty(): Promise<void> {
  try {
    const keys = Object.keys(INITIAL_PRODUCTS);
    for (const key of keys) {
      const pRef = doc(db, 'products', key);
      const snap = await getDoc(pRef);
      if (!snap.exists()) {
        await setDoc(pRef, {
          ...INITIAL_PRODUCTS[key],
          isPreorder: INITIAL_PRODUCTS[key].stock <= 0,
        });
        console.log(`[Kelvo] Initialized Firestore product: ${key}`);
      }
    }
  } catch (err) {
    console.error('[Kelvo] Error during Firestore product seeding:', err);
  }
}

/**
 * Real-time listener for products collection
 */
export function subscribeToProducts(
  callback: (products: Record<string, Product>) => void
): () => void {
  const colRef = collection(db, 'products');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map: Record<string, Product> = {};
      snapshot.forEach((d) => {
        const data = d.data();
        const stock = typeof data.stock === 'number' ? data.stock : 0;
        map[d.id] = {
          id: d.id,
          name: data.name || d.id,
          price: typeof data.price === 'number' ? data.price : 499,
          tastingNote: data.tastingNote || '',
          stock: Math.max(0, stock),
          isPreorder: Boolean(data.isPreorder) || stock <= 0,
        };
      });
      callback(map);
    },
    (err) => {
      console.error('[Kelvo] Error in products snapshot:', err);
    }
  );
}

/**
 * Atomic Order placement using Firestore runTransaction.
 * Decrements stock safely and never drops below 0.
 * If concurrent order exhausts stock, bumps to pre-order status.
 */
export async function placeOrder(orderData: {
  customerName: string;
  phone: string;
  email?: string;
  deliveryAddress: string;
  flavorId: string;
  flavorName: string;
  quantity: number;
  unitPrice: number;
  formatName?: string;
}): Promise<{ orderId: string; isPreorder: boolean; remainingStock: number }> {
  const productRef = doc(db, 'products', orderData.flavorId);
  const ordersCol = collection(db, 'orders');
  const newOrderRef = doc(ordersCol);

  let determinedIsPreorder = false;
  let finalRemainingStock = 0;

  await runTransaction(db, async (transaction) => {
    const productDoc = await transaction.get(productRef);
    let currentStock = 0;

    if (productDoc.exists()) {
      currentStock = Number(productDoc.data().stock) || 0;
    } else {
      // If product doc wasn't created yet, fall back to initial
      const initial = INITIAL_PRODUCTS[orderData.flavorId];
      currentStock = initial ? initial.stock : 0;
    }

    if (currentStock >= orderData.quantity) {
      // In-stock fulfillment
      finalRemainingStock = currentStock - orderData.quantity;
      determinedIsPreorder = false;
      transaction.set(
        productRef,
        {
          stock: finalRemainingStock,
          isPreorder: finalRemainingStock === 0,
        },
        { merge: true }
      );
    } else {
      // Stock insufficient or 0 -> bump to pre-order
      finalRemainingStock = 0;
      determinedIsPreorder = true;
      transaction.set(
        productRef,
        {
          stock: 0,
          isPreorder: true,
        },
        { merge: true }
      );
    }

    const totalAmount = orderData.unitPrice * orderData.quantity;
    const orderRecord = {
      customerName: orderData.customerName,
      phone: orderData.phone,
      email: orderData.email || '',
      deliveryAddress: orderData.deliveryAddress,
      items: [
        {
          flavor: orderData.flavorName,
          flavorId: orderData.flavorId,
          quantity: orderData.quantity,
          unitPrice: orderData.unitPrice,
          format: orderData.formatName || '500ml Craft Bottle',
        },
      ],
      totalAmount,
      status: 'pending',
      isPreorder: determinedIsPreorder,
      createdAt: serverTimestamp(),
    };

    transaction.set(newOrderRef, orderRecord);
  });

  return {
    orderId: newOrderRef.id,
    isPreorder: determinedIsPreorder,
    remainingStock: finalRemainingStock,
  };
}

/**
 * Admin: Update stock for a flavor directly in Firestore
 */
export async function updateProductStock(flavorId: string, newStock: number): Promise<void> {
  const pRef = doc(db, 'products', flavorId);
  const stockVal = Math.max(0, Math.floor(newStock));
  await updateDoc(pRef, {
    stock: stockVal,
    isPreorder: stockVal === 0,
  });
}

/**
 * Admin: Reset / reseed launch stock
 */
export async function resetLaunchStock(): Promise<void> {
  const keys = Object.keys(INITIAL_PRODUCTS);
  for (const key of keys) {
    const pRef = doc(db, 'products', key);
    await setDoc(pRef, {
      ...INITIAL_PRODUCTS[key],
      isPreorder: INITIAL_PRODUCTS[key].stock <= 0,
    });
  }
}

/**
 * Admin: Real-time listener for orders collection, newest first
 */
export function subscribeToOrders(callback: (orders: Order[]) => void): () => void {
  const ordersCol = collection(db, 'orders');
  // Order by createdAt desc (or client sort fallback if timestamps pending)
  return onSnapshot(
    ordersCol,
    (snapshot) => {
      const list: Order[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          customerName: data.customerName || 'Anonymous',
          phone: data.phone || '',
          email: data.email || '',
          deliveryAddress: data.deliveryAddress || '',
          items: Array.isArray(data.items) ? data.items : [],
          totalAmount: typeof data.totalAmount === 'number' ? data.totalAmount : 0,
          status: data.status || 'pending',
          isPreorder: Boolean(data.isPreorder),
          createdAt: data.createdAt,
        });
      });

      // Sort descending by date
      list.sort((a, b) => {
        const tA = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : Date.now());
        const tB = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : Date.now());
        return tB - tA;
      });

      callback(list);
    },
    (err) => {
      console.error('[Kelvo] Error in orders snapshot:', err);
    }
  );
}

/**
 * Admin: Update order fulfillment status
 */
export async function updateOrderStatus(
  orderId: string,
  newStatus: 'pending' | 'confirmed' | 'fulfilled'
): Promise<void> {
  const oRef = doc(db, 'orders', orderId);
  await updateDoc(oRef, {
    status: newStatus,
  });
}
