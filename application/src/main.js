import { createVueInstance } from './application/vue/index';
import { FirebaseInit } from './application/firebase/index';

(async () => {
  // firebaseのセッティングを行ってからVueを呼び出す
  await FirebaseInit.init();
  createVueInstance();
})();
