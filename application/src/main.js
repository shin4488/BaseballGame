import { createVueInstance } from './application/vue/index';
import { FirebaseInit } from './application/firebase/index';

(async () => {
  // 画面の初期化でログイン状態とFirestoreを使うため、Firebaseの初期化を待ってから画面を作る
  await FirebaseInit.init();
  createVueInstance();
})();
