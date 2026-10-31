import type { Request, Response } from 'express';

const homeController = {
  getHome: (req: Request, res: Response) => {
    res.render('home', { title: 'Home' });
  },
};

export default homeController;
